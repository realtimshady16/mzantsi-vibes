document.addEventListener('DOMContentLoaded', () => {
    // DOM elements
    const welcomeTextElement = document.getElementById('welcomeText');
    const panelsContainer = document.getElementById('panelsContainer');
    const contentSection = document.getElementById('contentSection');
    const backButton = document.getElementById('backButton');
    const sectionTitleElement = document.getElementById('sectionTitle');
    const linkContainer = document.getElementById('linkContainer');

    // Constants for the README file
    const GITHUB_USERNAME = 'realtimshady16'; 
    const REPO_NAME = 'mzantsi-vibes';
    const README_URL = `https://raw.githubusercontent.com/${GITHUB_USERNAME}/${REPO_NAME}/main/README.md`;

    // State variables
    let allReadmeContent = {};

    // Function to parse Markdown to get the index and content
    const parseReadme = (markdown) => {
    const sections = {};
    // Split by lines but keep track of the full text for regex
    const lines = markdown.split('\n');
    
    // Regex to match:
    // 1. ATX Headers: ### Heading
    // 2. Setext Headers: Heading followed by --- or ===
    let currentSection = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        const nextLine = lines[i + 1] ? lines[i + 1].trim() : '';
        
        let foundHeader = null;

        // Check for ATX style (### Heading)
        if (line.startsWith('#')) {
            foundHeader = line.replace(/^#+\s*/, '');
        } 
        // Check for Setext style (Underlined)
        else if (nextLine.startsWith('---') || nextLine.startsWith('===')) {
            if (line.length > 0) {
                foundHeader = line;
                i++; // Skip the underline line
            }
        }

        if (foundHeader) {
            // Clean up header name (remove links if they exist in the header)
            currentSection = foundHeader.replace(/\[(.*?)\]\(.*?\)/g, '$1').trim();
            // Don't overwrite if section already exists, just prepare to add links
            if (!sections[currentSection]) {
                sections[currentSection] = { links: [] };
            }
            continue;
        }

        // Identify links: [Text](URL)
        if (currentSection && line.includes('http')) {
            const linkMatch = line.match(/\[(.*?)\]\((.*?)\)/);
            if (linkMatch) {
                sections[currentSection].links.push({
                    text: linkMatch[1],
                    url: linkMatch[2]
                });
            }
        }
    }

    // Filter out empty sections like "Description" or "Index" to keep the UI clean
    const filteredSections = {};
    const ignoreList = ['INDEX', 'Description', 'MZANTSI VIBES', 'Contact Us', 'Community'];
    
    for (const key in sections) {
        if (!ignoreList.includes(key) && sections[key].links.length > 0) {
            filteredSections[key] = sections[key];
        }
    }

    return filteredSections;
};


    // Function to type out the welcome text
    const typeWriter = (text) => {
        let i = 0;
        welcomeTextElement.textContent = ''; // Clear content first
        welcomeTextElement.classList.add('typing-text-container');
        return new Promise(resolve => {
            function type() {
                if (i < text.length) {
                    welcomeTextElement.textContent += text.charAt(i);
                    i++;
                    setTimeout(type, 100); // Adjust typing speed here
                } else {
                    welcomeTextElement.classList.remove('typing-text-container');
                    welcomeTextElement.style.borderRight = 'none';
                    resolve();
                }
            }
            type();
        });
    };

    const createPanels = (sections) => {
    panelsContainer.innerHTML = '';
    const sectionNames = Object.keys(sections);

    // Update CSS to allow wrapping so the UI doesn't break with many sections
    panelsContainer.classList.add('flex-wrap', 'justify-center', 'gap-6');
    panelsContainer.style.opacity = '1';

    sectionNames.forEach((name, index) => {
        const panel = document.createElement('a');
        panel.href = `#${name.replace(/\s+/g, '-').toLowerCase()}`;
        // Standardize panel size for a clean grid
        panel.className = 'panel w-full sm:w-64 bg-gray-800 p-6 rounded-2xl shadow-lg border border-gray-700 hover:border-orange-500 hover:text-orange-500 transition-all duration-300';
        
        panel.innerHTML = `
            <h2 class="text-xl font-bold mb-2 text-center">${name}</h2>
            <p class="text-gray-400 text-sm text-center">View ${sections[name].links.length} resources</p>
        `;

        panel.addEventListener('click', (e) => {
            e.preventDefault();
            showSection(name);
            history.pushState({ section: name }, '', panel.href);
        });

        panelsContainer.appendChild(panel);

        setTimeout(() => {
            panel.classList.add('panel-visible');
        }, index * 100);
    });
};
    

    // Function to display the content for a specific section
    const showSection = (sectionName) => {
        panelsContainer.style.display = 'none';
        welcomeTextElement.style.display = 'none';
        contentSection.style.display = 'block';
        
        sectionTitleElement.textContent = sectionName;
        linkContainer.innerHTML = '';
        
        const sectionContent = allReadmeContent[sectionName] || { links: [] };
        
        // Create an iframe for each link in the section
        if (sectionContent.links.length > 0) {
            sectionContent.links.forEach((link, index) => {
                const iframeWrapper = document.createElement('div');
                iframeWrapper.className = 'iframe-container';

                const linkTitle = document.createElement('h3');
                linkTitle.className = 'text-lg font-medium text-orange-400 mb-2 truncate';
                linkTitle.textContent = link.text;
                
                const iframe = document.createElement('iframe');
                iframe.src = link.url;
                iframe.setAttribute('allowfullscreen', 'true');
                iframe.setAttribute('loading', 'lazy');
                iframe.title = link.text;

                iframeWrapper.appendChild(linkTitle);
                iframeWrapper.appendChild(iframe);
                linkContainer.appendChild(iframeWrapper);
                
                // Trigger staggered animation for iframes
                setTimeout(() => {
                    iframeWrapper.classList.add('visible');
                }, index * 100);
            });
        } else {
            linkContainer.innerHTML = `<p class="text-center text-gray-400">No resources found for this section yet.</p>`;
        }
    };

    // Function to show the home page
    const showHomePage = () => {
        welcomeTextElement.style.display = 'block';
        panelsContainer.style.display = 'flex';
        contentSection.style.display = 'none';
        history.pushState({}, '', '/');
    };

    // Handle back button clicks
    backButton.addEventListener('click', showHomePage);

    // Handle browser history navigation (back/forward buttons)
    window.addEventListener('popstate', (event) => {
        if (event.state && event.state.section) {
            showSection(event.state.section);
        } else {
            showHomePage();
        }
    });

    // Main initialization function
    const init = async () => {
        try {
            const response = await fetch(README_URL);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const markdownText = await response.text();
            allReadmeContent = parseReadme(markdownText);
            
            await typeWriter('Mzantsi Vibes'); // Start the typing animation
            createPanels(allReadmeContent); // Create the panels after typing is done
        } catch (error) {
            console.error('Error initializing application:', error);
            welcomeTextElement.textContent = 'Failed to load content. Please check the console for details.';
            welcomeTextElement.classList.remove('typing-text-container');
        }
    };
    
    // Start the application
    init();

});
