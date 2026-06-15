const express = require('express');
const path = require('path');

const app = express();
// Fly.io provides the PORT environment variable. We default to 8080 locally.
const port = process.env.PORT || 8080;

// Serve all static files (index.html, app.js, style.css) from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// Catch-all route to serve index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// IMPORTANT: Bind to 0.0.0.0 for Fly.io
app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on port ${port}`);
});
