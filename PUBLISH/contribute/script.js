// Global variables for the rich text editor instance and a Turndown service
    let quill = null;
    let turndownService = null;

    // A helper function to manage tab switching
    function switchTab(tabId) {
        document.querySelectorAll('.tab-link').forEach(btn => btn.classList.remove('active'));
        document.querySelector(`[data-tab="${tabId}"]`).classList.add('active');
        document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
        document.getElementById(`${tabId}-editor-container`).classList.add('active');
    }

    // 1. Get authenticated user's username
    async function getAuthenticatedUser() {
        const patInput = document.getElementById('pat');
        const statusDiv = document.getElementById('status');

        try {
            updateStatus('Authenticating with GitHub...', 'info');
            const userData = await githubApiFetch('https://api.github.com/user');
            githubUsername = userData.login;
            updateStatus(`Authenticated as: ${githubUsername}`, 'success');
            return true;
        } catch (error) {
            githubUsername = '';
            updateStatus(`Authentication failed. Check your PAT. ${error.message}`, 'error');
            return false;
        }
    }

    // Function to update status messages
    function updateStatus(message, type = 'info') {
        const statusDiv = document.getElementById('status');
        statusDiv.innerHTML = message;
        statusDiv.className = `status-box ${type}`;
    }

    // Helper function for API requests
    async function githubApiFetch(url, options = {}) {
        const patInput = document.getElementById('pat');
        const pat = patInput.value.trim();
        if (!pat) {
            updateStatus('Please enter your GitHub Personal Access Token.', 'error');
            throw new Error('PAT missing');
        }

        const headers = {
            'Authorization': `token ${pat}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json'
        };

        const response = await fetch(url, { ...options, headers });
        const data = await response.json();

        if (!response.ok) {
            updateStatus(`GitHub API Error: ${data.message || response.statusText}`, 'error');
            throw new Error(data.message || response.statusText);
        }
        return data;
    }
    
    let currentFileSha = '';
    let githubUsername = '';

    // Main event listeners
    document.addEventListener('DOMContentLoaded', () => {
        // --- INITIALIZE LIBRARIES FIRST ---
        const richtextEditorContainer = document.getElementById('richtext-editor-container');
        if (richtextEditorContainer) {
            quill = new Quill(richtextEditorContainer, {
                theme: 'snow',
                modules: {
                    toolbar: [
                        [{ 'header': [1, 2, 3, false] }],
                        ['bold', 'italic', 'underline', 'strike'],
                        ['blockquote', 'code-block'],
                        [{ 'list': 'ordered'}, { 'list': 'bullet' }],
                        [{ 'indent': '-1'}, { 'indent': '+1' }],
                        ['link', 'image'],
                        ['clean']
                    ]
                }
            });
        }
        // Configure Turndown for clean, consistent markdown output.
        // These settings ensure the README parser on the website
        // can reliably read whatever contributors submit via this tool.
        turndownService = new TurndownService({
            headingStyle: 'atx',        // Always use ## style, never underline style
            bulletListMarker: '-',      // Always use - for bullets, not * or +
            codeBlockStyle: 'fenced'    // Use ``` fences, not indentation
        });

        // Override heading rule to strip any bold/italic formatting that
        // Quill injects inside heading nodes. Without this, a bold heading
        // in Quill becomes ## **Heading** in markdown, which breaks parsing.
        turndownService.addRule('cleanHeadings', {
            filter: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
            replacement: function(content, node) {
                const level = parseInt(node.nodeName.charAt(1));
                const hashes = '#'.repeat(level);
                // Strip any markdown bold/italic Quill put inside the heading
                const cleanContent = content
                    .replace(/\*\*([^*]+)\*\*/g, '$1')
                    .replace(/\*([^*]+)\*/g, '$1')
                    .replace(/__([^_]+)__/g, '$1')
                    .replace(/_([^_]+)_/g, '$1')
                    .trim();
                return '\n\n' + hashes + ' ' + cleanContent + '\n\n';
            }
        });

        // Clean up trailing whitespace on each line after conversion
        const originalTurndown = turndownService.turndown.bind(turndownService);
        turndownService.turndown = function(html) {
            return originalTurndown(html)
                .split('\n')
                .map(line => line.trimEnd())
                .join('\n');
        };
        // --- END INITIALIZATION ---

        const ownerInput = document.getElementById('owner');
        const repoInput = document.getElementById('repo');
        const patInput = document.getElementById('pat');
        const readmeContentInput = document.getElementById('readmeContent');
        const commitMessageInput = document.getElementById('commitMessage');
        const prTitleInput = document.getElementById('prTitle');
        const prBodyInput = document.getElementById('prBody');
        const loadReadmeBtn = document.getElementById('loadReadmeBtn');
        const submitBtn = document.getElementById('submitBtn');
        const statusDiv = document.getElementById('status');
        
        // Handle tab clicks
        document.querySelectorAll('.tab-link').forEach(tab => {
            tab.addEventListener('click', () => {
                switchTab(tab.dataset.tab);
            });
        });

        // 2. Load README content
        loadReadmeBtn.addEventListener('click', async () => {
            const owner = ownerInput.value.trim();
            const repo = repoInput.value.trim();

            if (!(await getAuthenticatedUser())) return;
            if (!owner || !repo) {
                updateStatus('Please enter repository owner and name.', 'warning');
                return;
            }

            try {
                updateStatus('Loading README.md...', 'info');
                const readmeData = await githubApiFetch(`https://api.github.com/repos/${owner}/${repo}/contents/README.md`);
                const markdownContent = atob(readmeData.content);
                currentFileSha = readmeData.sha;
                
                // Load content into both editors
                readmeContentInput.value = markdownContent;
                const htmlContent = marked.parse(markdownContent);

                if (quill) {
                    quill.clipboard.dangerouslyPasteHTML(0, htmlContent);
                }
                
                updateStatus('README.md loaded successfully.', 'success');
                switchTab('richtext');
            } catch (error) {
                updateStatus(`Failed to load README.md: ${error.message}`, 'error');
                console.error('Error loading README:', error);
            }
        });

        // 3. Fork, Commit, and Create PR
        submitBtn.addEventListener('click', async () => {
            const owner = ownerInput.value.trim();
            const repo = repoInput.value.trim();
            const commitMessage = commitMessageInput.value.trim();
            const prTitle = prTitleInput.value.trim();
            const prBody = prBodyInput.value.trim();
            
            let newContent = '';
            const activeTab = document.querySelector('.tab-link.active').dataset.tab;

            if (activeTab === 'richtext') {
                const htmlContent = quill.root.innerHTML;
                newContent = turndownService.turndown(htmlContent);
            } else {
                newContent = readmeContentInput.value;
            }

            if (!(await getAuthenticatedUser())) return;
            if (!owner || !repo || !newContent || !commitMessage || !prTitle) {
                updateStatus('Please fill in all required fields.', 'warning');
                return;
            }
            if (!currentFileSha) {
                updateStatus('Please load the README.md first.', 'warning');
                return;
            }

            try {
                updateStatus('Starting contribution process...', 'info');

                // --- Step A: Check/Create Fork ---
                const forkUrl = `https://api.github.com/repos/${owner}/${repo}/forks`;
                let userForkedRepo = null;
                let forkedRepoOwner = githubUsername;
                let forkedRepoName = repo;
                
                const isOwner = githubUsername.toLowerCase() === owner.toLowerCase();

                if (!isOwner) {
                    try {
                        const userRepos = await githubApiFetch(`https://api.github.com/users/${githubUsername}/repos`);
                        userForkedRepo = userRepos.find(r => r.fork && r.source && r.source.owner.login === owner && r.source.name === repo);
                    } catch (e) {
                        console.warn('Could not list user repos to check for existing fork, proceeding to create fork attempt.');
                    }
                    
                    if (!userForkedRepo) {
                        updateStatus('Forking repository...', 'info');
                        await githubApiFetch(forkUrl, { method: 'POST' });
                        
                        updateStatus('Request accepted. Waiting for the fork to be created...', 'info');

                        let forkIsReady = false;
                        let maxRetries = 20;
                        let retryCount = 0;
                        const forkCheckUrl = `https://api.github.com/repos/${githubUsername}/${repo}`;

                        while (!forkIsReady && retryCount < maxRetries) {
                            retryCount++;
                            await new Promise(resolve => setTimeout(resolve, 3000));
                            
                            try {
                                const response = await fetch(forkCheckUrl, {
                                    headers: {
                                        'Authorization': `token ${patInput.value.trim()}`,
                                        'Accept': 'application/vnd.github.v3+json'
                                    }
                                });

                                if (response.ok) {
                                    const data = await response.json();
                                    if (data.fork && data.source && data.source.owner.login === owner && data.source.name === repo) {
                                        userForkedRepo = data;
                                        forkIsReady = true;
                                    }
                                }
                            } catch (error) {
                                console.error(`Attempt ${retryCount} to check fork failed:`, error);
                            }
                        }

                        if (!forkIsReady) {
                            throw new Error('Fork was not created or ready after several attempts. Please check GitHub manually.');
                        }
                        updateStatus('Fork created successfully!', 'success');
                    } else {
                        updateStatus(`Found existing fork: ${forkedRepoOwner}/${forkedRepoName}`, 'info');
                    }
                } else {
                    updateStatus('Authenticated user is the repository owner. Committing directly to a new branch.', 'info');
                }

                let targetRepoOwner = isOwner ? owner : forkedRepoOwner;
                let targetRepoName = isOwner ? repo : forkedRepoName;
                let targetDefaultBranch = userForkedRepo ? userForkedRepo.default_branch : null;

                if (!targetDefaultBranch) {
                    const repoInfo = await githubApiFetch(`https://api.github.com/repos/${targetRepoOwner}/${targetRepoName}`);
                    targetDefaultBranch = repoInfo.default_branch;
                }

                // --- Step B: Create a new branch on the target repo (fork or main) ---
                updateStatus('Getting latest branch info...', 'info');
                const defaultBranchRef = await githubApiFetch(`https://api.github.com/repos/${targetRepoOwner}/${targetRepoName}/git/refs/heads/${targetDefaultBranch}`);
                const baseBranchSha = defaultBranchRef.object.sha;
                const newBranchName = `contribute-readme-${Date.now()}`;

                updateStatus(`Creating new branch '${newBranchName}'...`, 'info');
                await githubApiFetch(`https://api.github.com/repos/${targetRepoOwner}/${targetRepoName}/git/refs`, {
                    method: 'POST',
                    body: JSON.stringify({
                        ref: `refs/heads/${newBranchName}`,
                        sha: baseBranchSha
                    })
                });

                // --- Step C: Commit the file change to the new branch ---
                updateStatus('Committing changes to README.md...', 'info');
                const contentEncoded = btoa(unescape(encodeURIComponent(newContent)));
                await githubApiFetch(`https://api.github.com/repos/${targetRepoOwner}/${targetRepoName}/contents/README.md`, {
                    method: 'PUT',
                    body: JSON.stringify({
                        message: commitMessage,
                        content: contentEncoded,
                        sha: currentFileSha,
                        branch: newBranchName
                    })
                });
                updateStatus('Changes committed successfully.', 'success');

                // --- Step D: Create Pull Request ---
                updateStatus('Creating pull request...', 'info');
                const prData = await githubApiFetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
                    method: 'POST',
                    body: JSON.stringify({
                        title: prTitle,
                        head: `${targetRepoOwner}:${newBranchName}`,
                        base: targetDefaultBranch,
                        body: prBody
                    })
                });

                updateStatus(`Pull Request created! 🎉 <a href="${prData.html_url}" target="_blank">View PR #${prData.number}</a>`, 'success');
            } catch (error) {
                updateStatus(`Contribution failed: ${error.message}`, 'error');
                console.error('Full contribution error:', error);
            }
        });
    });
