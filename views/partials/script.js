// Js for the light and dark mode
function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const nextTheme = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', nextTheme);
    localStorage.setItem('theme', nextTheme);
  }
  
  // On page load, set saved theme
  document.addEventListener("DOMContentLoaded", () => {
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
  });
  



// ?switch lanuage
  function switchLanguage() {
    fetch('switch_language.php')
        .then(response => response.text())
        .then(() => {
            location.reload();
        });
}