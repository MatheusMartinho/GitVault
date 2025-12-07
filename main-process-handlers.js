const { ipcMain, dialog } = require('electron');
const { execFile, spawn } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');

// Store repositories in a JSON file
const REPOS_FILE = path.join(os.homedir(), '.gitvault', 'repositories.json');

// Ensure the config directory exists
fs.ensureDirSync(path.dirname(REPOS_FILE));

// Load repositories from file
async function loadRepositories() {
  try {
    if (await fs.pathExists(REPOS_FILE)) {
      const data = await fs.readFile(REPOS_FILE, 'utf8');
      return JSON.parse(data);
    }
    return [];
  } catch (error) {
    console.error('Error loading repositories:', error);
    return [];
  }
}

// Save repositories to file
async function saveRepositories(repositories) {
  try {
    await fs.writeFile(REPOS_FILE, JSON.stringify(repositories, null, 2));
    return true;
  } catch (error) {
    console.error('Error saving repositories:', error);
    return false;
  }
}

// Execute Git command using execFile (simple, reliable, no shell issues)
function runGit(args, cwd, timeout = 60000) {
  return new Promise((resolve, reject) => {
    const options = {
      cwd,
      timeout,
      maxBuffer: 1024 * 1024, // 1MB
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    };

    execFile('git', args, options, (error, stdout, stderr) => {
      if (error) {
        // Check if it's a timeout
        if (error.killed) {
          reject(new Error('Command timed out'));
        } else {
          reject(new Error(stderr || error.message));
        }
        return;
      }
      resolve(stdout.trim());
    });
  });
}

// Pull changes using spawn for streaming (memory efficient)
ipcMain.handle('git:pull', async (event, repoPath) => {
  try {
    const result = await runGitStream(['pull', '--no-rebase', '--progress'], repoPath);
    return { success: true, result: result.output || 'Pull completed' };
  } catch (error) {
    const errorType = classifyGitError(error.message);
    return { 
      success: false, 
      error: getHumanReadableError(errorType, error.message),
      errorType,
      details: error.message 
    };
  }
});

/**
 * Optimized Git Push using spawn with streaming
 * - Memory efficient: streams data instead of buffering
 * - Respects system credentials (SSH keys, credential helpers)
 * - Granular error classification
 */
ipcMain.handle('git:push', async (event, repoPath) => {
  try {
    // Quick validation: check remote exists (fast, low memory)
    const remotes = await runGit(['remote'], repoPath, 5000).catch(() => '');
    
    if (!remotes || !remotes.includes('origin')) {
      return { 
        success: false, 
        error: 'No remote repository configured. Add a remote first.',
        errorType: 'NO_REMOTE'
      };
    }

    // Get current branch (fast operation)
    const branch = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], repoPath, 5000)
      .catch(() => 'HEAD');

    // Execute push with streaming - single call, no retry cascade
    const result = await runGitStream(
      ['push', '--set-upstream', 'origin', branch, '--progress'],
      repoPath,
      { timeout: 120000 } // 2 min timeout for large repos
    );

    return { 
      success: true, 
      result: result.output || 'Push completed successfully',
      branch 
    };

  } catch (error) {
    const errorType = classifyGitError(error.message);
    return { 
      success: false, 
      error: getHumanReadableError(errorType, error.message),
      errorType,
      details: error.message
    };
  }
});

/**
 * Stream-based Git command execution
 * - Uses spawn instead of execFile to avoid buffering entire output
 * - Streams stderr (where git progress goes) without memory accumulation
 * - Properly handles credential helpers and SSH
 */
function runGitStream(args, cwd, options = {}) {
  const { timeout = 60000, onProgress = null } = options;
  
  return new Promise((resolve, reject) => {
    const stdoutChunks = [];
    const stderrChunks = [];
    let stdoutSize = 0;
    let stderrSize = 0;
    const MAX_BUFFER = 512 * 1024; // 512KB max per stream
    
    const gitProcess = spawn('git', args, {
      cwd,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',      // Disable interactive prompts
        GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND || 'ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new'
      },
      stdio: ['ignore', 'pipe', 'pipe'] // stdin ignored, stdout/stderr piped
    });

    let timeoutId = null;
    let killed = false;

    // Timeout handler
    if (timeout > 0) {
      timeoutId = setTimeout(() => {
        killed = true;
        gitProcess.kill('SIGTERM');
        // Force kill after 5s if SIGTERM doesn't work
        setTimeout(() => {
          if (!gitProcess.killed) gitProcess.kill('SIGKILL');
        }, 5000);
      }, timeout);
    }

    // Stream stdout (actual command output)
    gitProcess.stdout.on('data', (chunk) => {
      if (stdoutSize < MAX_BUFFER) {
        stdoutChunks.push(chunk);
        stdoutSize += chunk.length;
      }
      // Discard excess to prevent memory bloat
    });

    // Stream stderr (progress info + errors)
    gitProcess.stderr.on('data', (chunk) => {
      if (stderrSize < MAX_BUFFER) {
        stderrChunks.push(chunk);
        stderrSize += chunk.length;
      }
      // Optional: emit progress to renderer
      if (onProgress && typeof onProgress === 'function') {
        onProgress(chunk.toString());
      }
    });

    gitProcess.on('error', (err) => {
      if (timeoutId) clearTimeout(timeoutId);
      reject(new Error(`Failed to start git: ${err.message}`));
    });

    gitProcess.on('close', (code, signal) => {
      if (timeoutId) clearTimeout(timeoutId);
      
      const stdout = Buffer.concat(stdoutChunks).toString('utf8').trim();
      const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
      
      // Clean up references
      stdoutChunks.length = 0;
      stderrChunks.length = 0;

      if (killed) {
        reject(new Error('TIMEOUT: Command timed out. Check your network connection.'));
        return;
      }

      if (signal) {
        reject(new Error(`Process killed by signal: ${signal}`));
        return;
      }

      if (code !== 0) {
        // Git outputs errors to stderr
        reject(new Error(stderr || `Git exited with code ${code}`));
        return;
      }

      resolve({ output: stdout || stderr, code });
    });
  });
}

/**
 * Classify git errors into actionable categories
 */
function classifyGitError(message) {
  const msg = message.toLowerCase();
  
  // Network errors
  if (msg.includes('could not resolve host') || 
      msg.includes('unable to access') ||
      msg.includes('connection refused') ||
      msg.includes('network is unreachable') ||
      msg.includes('timed out') ||
      msg.includes('timeout')) {
    return 'NETWORK_ERROR';
  }
  
  // Authentication errors
  if (msg.includes('authentication failed') ||
      msg.includes('permission denied') ||
      msg.includes('could not read from remote') ||
      msg.includes('invalid credentials') ||
      msg.includes('denied') ||
      msg.includes('403') ||
      msg.includes('401')) {
    return 'AUTH_ERROR';
  }
  
  // Conflict/rejection errors
  if (msg.includes('rejected') ||
      msg.includes('non-fast-forward') ||
      msg.includes('fetch first') ||
      msg.includes('cannot lock ref')) {
    return 'CONFLICT_ERROR';
  }
  
  // Upstream not set
  if (msg.includes('no upstream') ||
      msg.includes('does not have a commit checked out') ||
      msg.includes('no tracking information')) {
    return 'NO_UPSTREAM';
  }
  
  return 'UNKNOWN_ERROR';
}

/**
 * Convert error types to user-friendly messages
 */
function getHumanReadableError(errorType, originalMessage) {
  const messages = {
    'NETWORK_ERROR': 'Network error. Check your internet connection.',
    'AUTH_ERROR': 'Authentication failed. Check your credentials or SSH keys.',
    'CONFLICT_ERROR': 'Push rejected. Pull remote changes first.',
    'NO_UPSTREAM': 'No upstream branch configured.',
    'NO_REMOTE': 'No remote repository configured.',
    'UNKNOWN_ERROR': originalMessage || 'An unexpected error occurred.'
  };
  return messages[errorType] || originalMessage;
}

// Get repository status
ipcMain.handle('git:status', async (event, repoPath) => {
  try {
    const statusOutput = await runGit(['status', '--porcelain'], repoPath, 5000);

    if (!statusOutput) {
      return [];
    }

    const changes = statusOutput.split('\n').filter(line => line.trim()).map(line => {
      const status = line.substring(0, 2).trim();
      const file = line.substring(3).trim();

      let statusText = 'modified';
      if (status === 'A' || status.includes('A')) statusText = 'added';
      if (status === 'D' || status.includes('D')) statusText = 'deleted';
      if (status === 'M' || status.includes('M')) statusText = 'modified';
      if (status === '??') statusText = 'untracked';

      return { file, status: statusText };
    });

    return changes;
  } catch (error) {
    return [];
  }
});

// Get commit log
ipcMain.handle('git:log', async (event, repoPath) => {
  try {
    const logOutput = await runGit(
      ['log', '--pretty=format:%H|%an|%ad|%s', '--date=short', '-20'],
      repoPath,
      10000
    );

    if (!logOutput) {
      return [];
    }

    const commits = logOutput.split('\n').filter(line => line.trim()).map(line => {
      const [hash, author, date, message] = line.split('|');
      return { hash, author, date, message };
    });

    return commits;
  } catch (error) {
    return [];
  }
});

// Get branches
ipcMain.handle('git:branches', async (event, repoPath) => {
  try {
    const branchesOutput = await runGit(['branch', '-a'], repoPath, 5000);

    if (!branchesOutput) {
      return [];
    }

    const branches = branchesOutput
      .split('\n')
      .map(branch => branch.replace('*', '').trim())
      .filter(branch => branch.length > 0);

    return branches;
  } catch (error) {
    return [];
  }
});

// Add files to staging
ipcMain.handle('git:add', async (event, repoPath) => {
  try {
    await runGit(['add', '.'], repoPath, 10000);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Commit changes
ipcMain.handle('git:commit', async (event, repoPath, message) => {
  try {
    const result = await runGit(['commit', '-m', message], repoPath, 10000);
    return { success: true, result: result || 'Commit completed' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Get repositories
ipcMain.handle('repositories:get', async () => {
  return await loadRepositories();
});

// Add repository
ipcMain.handle('repositories:add', async (event, repoPath) => {
  try {
    // Validate that repoPath is provided
    if (!repoPath) {
      return { success: false, error: 'Repository path is required' };
    }

    // Check if it's a git repository
    const gitDir = path.join(repoPath, '.git');
    if (!(await fs.pathExists(gitDir))) {
      return { success: false, error: 'Not a Git repository' };
    }

    // Get repository name from folder name
    const name = path.basename(repoPath);

    // Load existing repositories
    const repositories = await loadRepositories();

    // Check if repository already exists
    const exists = repositories.some(repo => repo.path === repoPath);
    if (exists) {
      return { success: false, error: 'Repository already added' };
    }

    // Add new repository
    repositories.push({ name, path: repoPath });

    // Save repositories
    const saved = await saveRepositories(repositories);
    if (!saved) {
      return { success: false, error: 'Failed to save repository' };
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Remove repository
ipcMain.handle('repositories:remove', async (event, repoPath) => {
  try {
    // Validate that repoPath is provided
    if (!repoPath) {
      return { success: false, error: 'Repository path is required' };
    }

    // Load existing repositories
    let repositories = await loadRepositories();

    // Filter out the repository to remove
    repositories = repositories.filter(repo => repo.path !== repoPath);

    // Save repositories
    const saved = await saveRepositories(repositories);
    if (!saved) {
      return { success: false, error: 'Failed to save repositories' };
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Show notification
ipcMain.on('notification:show', (event, title, body) => {
  const notification = new Notification({
    title,
    body
  });

  notification.show();
});

// File system operations
ipcMain.handle('fs:readFile', async (event, filePath) => {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return { success: true, content };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('fs:writeFile', async (event, filePath, content) => {
  try {
    await fs.writeFile(filePath, content, 'utf8');
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Select directory dialog
ipcMain.handle('dialog:selectDirectory', async (event) => {
  try {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select Git Repository Folder'
    });

    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0]; // Return the selected directory path
    }

    return null; // User canceled the dialog
  } catch (error) {
    console.error('Error selecting directory:', error);
    return null;
  }
});

