import React, { useState, useEffect } from 'react';
import './App.css';

function App() {
  const [repositories, setRepositories] = useState([]);
  const [activeRepo, setActiveRepo] = useState(null);
  const [branches, setBranches] = useState([]);
  const [commits, setCommits] = useState([]);
  const [changes, setChanges] = useState([]);
  const [loading, setLoading] = useState(false);
  const [notification, setNotification] = useState(null);
  const [commitMessage, setCommitMessage] = useState('');
  const [updateStatus, setUpdateStatus] = useState({
    available: false,
    downloading: false,
    downloaded: false,
    progress: 0,
    version: null
  });

  // Load repositories on component mount
  useEffect(() => {
    loadRepositories();
  }, []);

  // Setup update listeners
  useEffect(() => {
    // Listen for update checking
    window.electronAPI.onUpdateChecking(() => {
      setNotification('Checking', 'Checking for updates...');
    });

    // Listen for update available
    window.electronAPI.onUpdateAvailable((event, info) => {
      setUpdateStatus(prev => ({
        ...prev,
        available: true,
        version: info.version
      }));
      showNotification('Update Available', `Version ${info.version} is available for download`);
    });

    // Listen for update not available
    window.electronAPI.onUpdateNotAvailable(() => {
      setUpdateStatus(prev => ({
        ...prev,
        available: false
      }));
      // Only show notification if user manually checked for updates
    });

    // Listen for download progress
    window.electronAPI.onUpdateDownloadProgress((event, progress) => {
      setUpdateStatus(prev => ({
        ...prev,
        downloading: true,
        progress: Math.round(progress.percent)
      }));
    });

    // Listen for update downloaded
    window.electronAPI.onUpdateDownloaded(() => {
      setUpdateStatus(prev => ({
        ...prev,
        downloading: false,
        downloaded: true
      }));
      showNotification('Update Ready', 'Update downloaded. Restart the app to install.');
    });

    // Listen for update errors
    window.electronAPI.onUpdateError((event, error) => {
      setUpdateStatus(prev => ({
        ...prev,
        downloading: false,
        available: false // Hide update button if there was an error
      }));
      // Only show notification if it's not a 404 (no updates available)
      if (!error.includes('404') && !error.includes('not found')) {
        showNotification('Update Error', `Update check failed: ${error}`);
      }
    });

    return () => {
      // Cleanup listeners if needed
    };
  }, []);

  // Function to check for updates
  const checkForUpdates = async () => {
    try {
      const result = await window.electronAPI.checkForUpdates();
      if (result.success) {
        showNotification('Update', 'Checking for updates...');
      } else {
        showNotification('Error', `Failed to check for updates: ${result.error}`);
      }
    } catch (error) {
      showNotification('Error', `Failed to check for updates: ${error.message}`);
    }
  };

  // Function to download update
  const downloadUpdate = async () => {
    try {
      setUpdateStatus(prev => ({
        ...prev,
        downloading: true
      }));

      const result = await window.electronAPI.downloadUpdate();
      if (result.success) {
        showNotification('Downloading', 'Downloading update...');
      } else {
        showNotification('Error', `Failed to download update: ${result.error}`);
        setUpdateStatus(prev => ({
          ...prev,
          downloading: false
        }));
      }
    } catch (error) {
      showNotification('Error', `Failed to download update: ${error.message}`);
      setUpdateStatus(prev => ({
        ...prev,
        downloading: false
      }));
    }
  };

  // Function to install update
  const installUpdate = async () => {
    try {
      await window.electronAPI.quitAndInstall();
    } catch (error) {
      showNotification('Error', `Failed to install update: ${error.message}`);
    }
  };

  // Load repositories from the main process
  const loadRepositories = async () => {
    try {
      const repos = await window.electronAPI.getRepositories();
      setRepositories(repos);
    } catch (error) {
      showNotification('Error', 'Failed to load repositories');
    }
  };

  // Add a new repository
  const addRepository = async () => {
    try {
      const path = await window.electronAPI.selectDirectory();
      if (path) {
        const result = await window.electronAPI.addRepository(path);
        if (result.success) {
          showNotification('Success', 'Repository added successfully');
          loadRepositories();
        } else {
          showNotification('Error', result.error || 'Failed to add repository');
        }
      }
    } catch (error) {
      showNotification('Error', 'Failed to add repository');
    }
  };

  // Remove a repository
  const removeRepository = async (path) => {
    try {
      const result = await window.electronAPI.removeRepository(path);
      if (result.success) {
        showNotification('Success', 'Repository removed successfully');
        loadRepositories();
        if (activeRepo && activeRepo.path === path) {
          setActiveRepo(null);
        }
      } else {
        showNotification('Error', result.error || 'Failed to remove repository');
      }
    } catch (error) {
      showNotification('Error', 'Failed to remove repository');
    }
  };

  // Select a repository
  const selectRepository = async (repo) => {
    if (loading) return; // Prevent concurrent calls
    setLoading(true);
    try {
      setActiveRepo(repo);

      // Load branches
      const branchData = await window.electronAPI.gitBranches(repo.path);
      setBranches(branchData);

      // Load commits
      const commitData = await window.electronAPI.gitLog(repo.path);
      setCommits(commitData);

      // Load changes
      const statusData = await window.electronAPI.gitStatus(repo.path);
      setChanges(statusData);
    } catch (error) {
      showNotification('Error', 'Failed to load repository data');
    } finally {
      setLoading(false);
    }
  };

  // Show notification
  const showNotification = (title, message) => {
    setNotification({ title, message });
    setTimeout(() => setNotification(null), 3000);
  };

  // Commit changes
  const commitChanges = async () => {
    if (!commitMessage.trim()) {
      showNotification('Error', 'Please enter a commit message');
      return;
    }

    if (!changes || changes.length === 0) {
      showNotification('Error', 'No changes to commit');
      return;
    }

    try {
      // First stage all changes (git add .)
      await window.electronAPI.gitAdd(activeRepo.path);

      // Then commit with message
      const result = await window.electronAPI.gitCommit(activeRepo.path, commitMessage);
      if (result.success) {
        showNotification('Success', 'Changes committed successfully');
        setCommitMessage('');
        // Reload repository data to show new commit
        selectRepository(activeRepo);
      } else {
        showNotification('Error', result.error || 'Failed to commit changes');
      }
    } catch (error) {
      showNotification('Error', 'Failed to commit changes');
    }
  };

  return (
    <div className="app">
      {/* Header */}
      <header className="app-header">
        <h1>GitVault</h1>
        <div className="header-actions">
          <button onClick={() => addRepository()}>Add Repository</button>
          {updateStatus.available && updateStatus.version && !updateStatus.downloaded && (
            <button
              className={`update-btn ${updateStatus.downloading ? 'downloading' : ''}`}
              onClick={updateStatus.downloading ? null : downloadUpdate}
              disabled={updateStatus.downloading}
            >
              {updateStatus.downloading ? `Downloading... ${updateStatus.progress}%` : `Update to v${updateStatus.version}!`}
            </button>
          )}
          {updateStatus.downloaded && (
            <button
              className="update-btn installed"
              onClick={installUpdate}
            >
              Restart to Update
            </button>
          )}
          <button
            className="check-update-btn"
            onClick={checkForUpdates}
            title="Check for updates"
          >
            ↻
          </button>
        </div>
      </header>

      {/* Notification */}
      {notification && (
        <div className="notification">
          <h4>{notification.title}</h4>
          <p>{notification.message}</p>
        </div>
      )}

      <div className="app-content">
        {/* Sidebar with repositories */}
        <aside className="sidebar">
          <h2>Repositories</h2>
          <ul className="repository-list">
            {repositories.map((repo) => (
              <li 
                key={repo.path} 
                className={activeRepo && activeRepo.path === repo.path ? 'active' : ''}
                onClick={() => selectRepository(repo)}
              >
                <span className="repo-name">{repo.name}</span>
                <button 
                  className="remove-btn" 
                  onClick={(e) => {
                    e.stopPropagation();
                    removeRepository(repo.path);
                  }}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {/* Main content area */}
        <main className="main-content">
          {loading ? (
            <div className="loading">Loading...</div>
          ) : activeRepo ? (
            <div className="repo-details">
              <div className="repo-header">
                <h2>{activeRepo.name}</h2>
                <div className="repo-actions">
                  <button
                    onClick={async () => {
                      try {
                        const result = await window.electronAPI.gitPull(activeRepo.path);
                        if (result.success) {
                          showNotification('Success', 'Repository pulled successfully');
                          // Reload repository data to show updated status
                          selectRepository(activeRepo);
                        } else {
                          showNotification('Error', `Pull failed: ${result.error}`);
                        }
                      } catch (error) {
                        showNotification('Error', `Pull failed: ${error.message}`);
                      }
                    }}
                  >
                    Pull
                  </button>
                  <button
                    onClick={async () => {
                      try {
                        // First check if there are uncommitted changes
                        const status = await window.electronAPI.gitStatus(activeRepo.path);
                        if (status && status.length > 0) {
                          showNotification('Info', `You have ${status.length} uncommitted change(s). Please commit them first.`);
                          return;
                        }

                        const result = await window.electronAPI.gitPush(activeRepo.path);
                        if (result.success) {
                          showNotification('Success', 'Repository pushed successfully');
                          // Reload repository data to show updated status
                          selectRepository(activeRepo);
                        } else {
                          // If push is rejected due to remote commits, suggest pulling first
                          if (result.error.includes('Pull changes first') || result.error.includes('newer commits')) {
                            if (window.confirm('Remote repository has newer commits. Would you like to pull first? This will update your local repository.')) {
                              const pullResult = await window.electronAPI.gitPull(activeRepo.path);
                              if (pullResult.success) {
                                showNotification('Success', 'Pulled changes. You can now push again.');
                                selectRepository(activeRepo); // Refresh the view
                              } else {
                                showNotification('Error', `Pull failed: ${pullResult.error}`);
                              }
                            } else {
                              showNotification('Info', 'Please pull changes manually before pushing.');
                            }
                          } else {
                            showNotification('Error', `Push failed: ${result.error}`);
                          }
                        }
                      } catch (error) {
                        showNotification('Error', `Push failed: ${error.message}`);
                      }
                    }}
                  >
                    Push
                  </button>
                </div>
              </div>

              <div className="repo-content">
                {/* Branch selector */}
                <section className="branches-section">
                  <h3>Branches</h3>
                  <select>
                    {branches.map((branch) => (
                      <option key={branch} value={branch}>{branch}</option>
                    ))}
                  </select>
                </section>

                {/* Changes section with commit functionality */}
                <section className="changes-section">
                  <div className="changes-header">
                    <h3>Changes</h3>
                    {changes.length > 0 && (
                      <div className="commit-controls">
                        <input
                          type="text"
                          placeholder="Commit message"
                          value={commitMessage}
                          onChange={(e) => setCommitMessage(e.target.value)}
                          className="commit-message-input"
                        />
                        <button onClick={commitChanges} className="commit-btn">
                          Commit
                        </button>
                      </div>
                    )}
                  </div>

                  {changes.length > 0 ? (
                    <ul className="changes-list">
                      {changes.map((change, index) => (
                        <li key={index} className={`change-item ${change.status}`}>
                          <span className="change-status">{change.status}</span>
                          <span className="change-file">{change.file}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>No changes to commit</p>
                  )}
                </section>

                {/* Commit history */}
                <section className="history-section">
                  <h3>Commit History</h3>
                  <ul className="commit-history">
                    {commits.map((commit) => (
                      <li key={commit.hash} className="commit-item">
                        <div className="commit-header">
                          <strong>{commit.author}</strong>
                          <span className="commit-date">{commit.date}</span>
                        </div>
                        <div className="commit-message">{commit.message}</div>
                        <div className="commit-hash">{commit.hash.substring(0, 7)}</div>
                      </li>
                    ))}
                  </ul>
                </section>
              </div>
            </div>
          ) : (
            <div className="welcome-screen">
              <h2>Welcome to GitVault</h2>
              <p>Select a repository or add a new one to get started</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default App;