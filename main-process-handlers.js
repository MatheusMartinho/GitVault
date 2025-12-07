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

// Execute a Git command
function executeGitCommand(command, cwd) {
  return new Promise((resolve, reject) => {
    exec(command, { cwd }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

// Pull changes
ipcMain.handle('git:pull', async (event, repoPath) => {
  try {
    // First check if there's a remote configured
    try {
      await executeGitCommand('git remote get-url origin', repoPath);
    } catch (remoteError) {
      return { success: false, error: 'No remote repository configured. Add a remote first.' };
    }

    // Pull with rebase to avoid merge conflicts when possible
    const command = 'git pull --rebase';
    const result = await executeGitCommand(command, repoPath);
    return { success: true, result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Push changes
ipcMain.handle('git:push', async (event, repoPath) => {
  try {
    // First check if there's a remote configured
    try {
      await executeGitCommand('git remote get-url origin', repoPath);
    } catch (remoteError) {
      // If no remote exists, return error
      return { success: false, error: 'No remote repository configured. Add a remote first.' };
    }

    // Check if there are commits to push
    const hasCommits = await executeGitCommand('git log origin/main..HEAD', repoPath).catch(() => '');

    // If no commits to push, try the default push with set-upstream
    const command = 'git push --set-upstream origin HEAD';
    const result = await executeGitCommand(command, repoPath);
    return { success: true, result };
  } catch (error) {
    // Try a simpler push command for different repository configurations
    try {
      const simpleCommand = 'git push';
      const simpleResult = await executeGitCommand(simpleCommand, repoPath);
      return { success: true, result: simpleResult };
    } catch (simpleError) {
      // If all else fails, return the original error
      return { success: false, error: error.message };
    }
  }
});

// Get repository status
ipcMain.handle('git:status', async (event, repoPath) => {
  try {
    // Get status in porcelain format for easier parsing
    const statusOutput = await executeGitCommand('git status --porcelain', repoPath);

    if (!statusOutput) {
      return [];
    }

    const changes = statusOutput.split('\n').map(line => {
      const status = line.substring(0, 2).trim();
      const file = line.substring(3).trim();

      let statusText = 'modified';
      if (status === 'A') statusText = 'added';
      if (status === 'D') statusText = 'deleted';
      if (status === 'M') statusText = 'modified';
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
    const logOutput = await executeGitCommand(
      'git log --pretty=format:"%H|%an|%ad|%s" --date=short -20',
      repoPath
    );

    if (!logOutput) {
      return [];
    }

    const commits = logOutput.split('\n').map(line => {
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
    const branchesOutput = await executeGitCommand('git branch -a', repoPath);

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

// Add files to staging (git add)
ipcMain.handle('git:add', async (event, repoPath) => {
  try {
    const command = 'git add .';
    await executeGitCommand(command, repoPath);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Commit changes
ipcMain.handle('git:commit', async (event, repoPath, message) => {
  try {
    const command = `git commit -m "${message.replace(/"/g, '\\"')}"`;
    const result = await executeGitCommand(command, repoPath);
    return { success: true, result };
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

