const { ipcMain, dialog } = require('electron');
const { spawn } = require('child_process');
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

// Execute Git command using spawn (memory efficient, no buffering)
function executeGitCommand(command, cwd, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const args = command.split(' ').slice(1); // Remove 'git' from command
    const gitCommand = command.split(' ')[0]; // Should be 'git'

    let stdout = '';
    let stderr = '';
    let killed = false;

    const proc = spawn(gitCommand, args, {
      cwd,
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Timeout handler
    const timer = setTimeout(() => {
      killed = true;
      proc.kill('SIGTERM');
    }, timeout);

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      clearTimeout(timer);

      if (killed) {
        reject(new Error('Command timed out'));
        return;
      }

      if (code !== 0) {
        reject(new Error(stderr || `Git exited with code ${code}`));
        return;
      }

      resolve(stdout.trim());
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// Pull changes - Simple and Fast
ipcMain.handle('git:pull', async (event, repoPath) => {
  try {
    const result = await executeGitCommand('git pull', repoPath, 30000);
    return { success: true, result: result || 'Pull completed' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Push changes - Simple and Fast
ipcMain.handle('git:push', async (event, repoPath) => {
  try {
    const result = await executeGitCommand('git push', repoPath, 30000);
    return { success: true, result: result || 'Push completed' };
  } catch (error) {
    // Try with upstream if needed
    if (error.message.includes('upstream') || error.message.includes('set-upstream')) {
      try {
        const result = await executeGitCommand('git push -u origin HEAD', repoPath, 30000);
        return { success: true, result: result || 'Push completed' };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }
    return { success: false, error: error.message };
  }
});

// Get repository status - Optimized
ipcMain.handle('git:status', async (event, repoPath) => {
  try {
    const statusOutput = await executeGitCommand('git status --porcelain', repoPath, 5000);

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

// Get commit log - Optimized
ipcMain.handle('git:log', async (event, repoPath) => {
  try {
    const logOutput = await executeGitCommand(
      'git log --pretty=format:"%H|%an|%ad|%s" --date=short -20',
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

// Get branches - Optimized
ipcMain.handle('git:branches', async (event, repoPath) => {
  try {
    const branchesOutput = await executeGitCommand('git branch -a', repoPath, 5000);

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

// Add files to staging (git add) - Optimized
ipcMain.handle('git:add', async (event, repoPath) => {
  try {
    await executeGitCommand('git add .', repoPath, 10000);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Commit changes - Simple
ipcMain.handle('git:commit', async (event, repoPath, message) => {
  try {
    // Basic escape for quotes
    const safeMessage = message.replace(/"/g, '\\"');
    const result = await executeGitCommand(`git commit -m "${safeMessage}"`, repoPath, 10000);
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

