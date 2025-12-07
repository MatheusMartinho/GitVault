const { ipcMain, dialog } = require('electron');
const { exec } = require('child_process');
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

// Execute a Git command with timeout support
function executeGitCommand(command, cwd, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const options = {
      cwd,
      timeout,
      maxBuffer: 1024 * 1024 * 10, // 10MB buffer for large outputs
      killSignal: 'SIGTERM'
    };

    exec(command, options, (error, stdout, stderr) => {
      if (error) {
        if (error.killed || error.signal === 'SIGTERM') {
          reject(new Error(`Command timed out after ${timeout}ms`));
        } else {
          reject(new Error(stderr || error.message));
        }
        return;
      }
      resolve(stdout.trim());
    });
  });
}

// Pull changes - Optimized version
ipcMain.handle('git:pull', async (event, repoPath) => {
  try {
    // Parallelize remote and branch checks
    const [remoteUrl, branch] = await Promise.all([
      executeGitCommand('git remote get-url origin', repoPath, 5000).catch(() => null),
      executeGitCommand('git branch --show-current', repoPath, 5000).catch(() => null)
    ]);

    // Validate remote
    if (!remoteUrl) {
      return { success: false, error: 'No remote repository configured. Add a remote first.' };
    }

    // Validate branch
    if (!branch || branch.trim() === '') {
      return { success: false, error: 'Not on any branch. Cannot pull.' };
    }

    const currentBranch = branch.trim();

    // Try pull with rebase for cleaner history (60s timeout for large repos)
    try {
      const result = await executeGitCommand(`git pull --rebase origin ${currentBranch}`, repoPath, 60000);
      return { success: true, result };
    } catch (rebaseError) {
      const errorMsg = rebaseError.message.toLowerCase();

      // Handle unstaged changes
      if (errorMsg.includes('unstaged') || errorMsg.includes('uncommitted')) {
        try {
          await executeGitCommand('git stash', repoPath, 10000);
          const result = await executeGitCommand(`git pull --rebase origin ${currentBranch}`, repoPath, 60000);
          await executeGitCommand('git stash pop', repoPath, 10000).catch(() => { });
          return { success: true, result };
        } catch (stashError) {
          // Fallback to normal pull
          try {
            const fallbackResult = await executeGitCommand(`git pull origin ${currentBranch}`, repoPath, 60000);
            return { success: true, result: fallbackResult };
          } catch (normalPullError) {
            return { success: false, error: normalPullError.message };
          }
        }
      }

      // Try normal pull as fallback
      try {
        const fallbackResult = await executeGitCommand(`git pull origin ${currentBranch}`, repoPath, 60000);
        return { success: true, result: fallbackResult };
      } catch (fallbackError) {
        return { success: false, error: fallbackError.message };
      }
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Push changes - Optimized version
ipcMain.handle('git:push', async (event, repoPath) => {
  try {
    // Parallelize remote and branch checks for better performance
    const [remotes, branch] = await Promise.all([
      executeGitCommand('git remote', repoPath, 5000).catch(() => ''),
      executeGitCommand('git branch --show-current', repoPath, 5000).catch(() => '')
    ]);

    // Validate remote
    if (!remotes || !remotes.includes('origin')) {
      return { success: false, error: 'No remote repository named "origin" configured. Add a remote first.' };
    }

    // Validate branch
    const currentBranch = branch.trim();
    if (!currentBranch) {
      return { success: false, error: 'Cannot push from detached HEAD state. Please checkout a branch.' };
    }

    // Execute push with reasonable timeout (60s for large repos)
    const result = await executeGitCommand(`git push origin ${currentBranch}`, repoPath, 60000);
    return { success: true, result };

  } catch (error) {
    const errorMsg = error.message.toLowerCase();

    // Handle upstream branch not set
    if (errorMsg.includes('upstream') || errorMsg.includes('set-upstream')) {
      try {
        const branch = await executeGitCommand('git branch --show-current', repoPath, 5000);
        const result = await executeGitCommand(`git push --set-upstream origin ${branch.trim()}`, repoPath, 60000);
        return { success: true, result };
      } catch (setUpstreamError) {
        return { success: false, error: 'Failed to set upstream branch.' };
      }
    }

    // Handle rejected push
    if (errorMsg.includes('rejected') || errorMsg.includes('non-fast-forward')) {
      return { success: false, error: 'Push rejected. Remote repository has newer commits. Please pull changes first.' };
    }

    // Handle authentication errors
    if (errorMsg.includes('denied') || errorMsg.includes('authentication')) {
      return { success: false, error: 'Authentication failed. Check your credentials.' };
    }

    // Handle timeout
    if (errorMsg.includes('timed out')) {
      return { success: false, error: 'Push operation timed out. Check your network connection.' };
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

// Commit changes - Optimized version
ipcMain.handle('git:commit', async (event, repoPath, message) => {
  try {
    // Escape message properly and execute with timeout
    const escapedMessage = message.replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$/g, '\\$');
    const command = `git commit -m "${escapedMessage}"`;
    const result = await executeGitCommand(command, repoPath, 10000);
    return { success: true, result };
  } catch (error) {
    const errorMsg = error.message.toLowerCase();

    // Provide better error messages
    if (errorMsg.includes('nothing to commit')) {
      return { success: false, error: 'No changes staged for commit. Use git add first.' };
    }
    if (errorMsg.includes('timed out')) {
      return { success: false, error: 'Commit operation timed out.' };
    }
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

