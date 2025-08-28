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
        // Use a simple, custom parser to get the sections
        const sections = {};
        const lines = markdown.split('\n');
        let currentSection = null;
        let links = [];

        for (const line of lines) {
            // Find the main section headings (e.g., "High School", "Matric")
            if (line.trim().startsWith('---')) {
                // A common pattern for horizontal rules, we can use this to end a section
                if (currentSection) {
                    sections[currentSection] = { links: links };
                }
                currentSection = null;
                links = [];
            } else if (line.trim().startsWith('###')) {
                // Ignore subheadings
            } else if (line.trim().endsWith('---')) {
                const heading = line.replace('---', '').trim();
                // This pattern seems to be the one we need for the main headings
                if (currentSection) {
                    sections[currentSection] = { links: links };
                }
                currentSection = heading;
                links = [];
            } else if (line.trim().startsWith('*') && line.includes('http')) {
                // Find all list items that contain links
                const match = line.match(/\[(.*?)\]\((.*?)\)/);
                if (match) {
                    const text = match[1];
                    const url = match[2];
                    if (currentSection) {
                        links.push({ text, url });
                    }
                }
            }
        }
        // Add the last section
        if (currentSection) {
            sections[currentSection] = { links: links };
        }
        return sections;
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

    // Function to create and slide up panels for each section
    const createPanels = (sections) => {
        panelsContainer.innerHTML = ''; // Clear any existing panels
        const panelData = [
            { text: "High School", link: "High School" },
            { text: "Matric", link: "Matric" },
            { text: "University", link: "University" },
            { text: "Internships", link: "Internships" },
            { text: "Graduate Programmes", link: "Graduate Programmes" },
            { text: "Skills and Training", link: "Skills and Training" },
            { text: "How do I adult?", link: "How do I adult?" },
            { text: "Community", link: "Community" },
            { text: "Contact Us", link: "Contact Us" }
        ];

        // Ensure the panelsContainer is visible
        panelsContainer.style.opacity = '1';

        panelData.forEach((item, index) => {
            const panel = document.createElement('a');
            panel.href = `#${item.link.replace(/\s+/g, '-').toLowerCase()}`;
            panel.className = 'panel flex-1 bg-gray-800 p-8 rounded-2xl shadow-lg border border-gray-700 hover:border-orange-500 hover:text-orange-500 transition-colors duration-300';
            panel.innerHTML = `<h2 class="text-2xl font-semibold mb-2 text-center">${item.text}</h2><p class="text-gray-400 text-center">Explore resources for ${item.text.toLowerCase()}.</p>`;
            panel.style.transitionDelay = `${index * 50}ms`; // Stagger the animation
            panelsContainer.appendChild(panel);
            
            // Add click listener to handle SPA-like navigation
            panel.addEventListener('click', (e) => {
                e.preventDefault();
                showSection(item.link);
                history.pushState({ section: item.link }, '', panel.href);
            });
            // Trigger the animation for each panel
            setTimeout(() => {
                panel.classList.add('panel-visible');
            }, index * 200);
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
