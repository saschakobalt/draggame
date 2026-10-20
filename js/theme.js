const themeToggleBtn = document.getElementById('themeToggleBtn');
const storedTheme = localStorage.getItem('dragger-theme') || 'light';

document.documentElement.setAttribute('data-theme', storedTheme);

if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', () => {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const targetTheme = currentTheme === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', targetTheme);
        localStorage.setItem('dragger-theme', targetTheme);
    });
}