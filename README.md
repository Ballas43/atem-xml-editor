# ATEM XML Editor

> [!WARNING]
> **Disclaimer:** This project contains some AI-generated code. It was built with the assistance of an AI coding agent. If an AI-generated project doesn't align with your preferences, feel free to fork and modify it. This project is open-source and available under the GPL-3.0 license.

A sleek, visual web dashboard for editing Blackmagic Design ATEM switcher configuration (`.xml`) files. 

If you work with live events, you know how many ATEM switchers you need to configure. But what if you don't have access to the ATEM hardware, or you just want to create a configuration for a future event? This tool solves that by providing an intuitive, drag-and-drop web interface that reads your XML, lets you visually configure the switcher, and exports a perfectly formatted, ready-to-restore XML file.

## Features

- **Universal ATEM Support**: Automatically detects your hardware model, from the compact **ATEM Mini** family all the way up to the massive **Constellation 8K**.
- **Labels & Routing**: Quickly rename physical inputs, virtual sources (Media Players, SuperSources), and outputs without digging through XML nodes. 
- **Audio Mix Toggles**: Set your input audio states (`ON`, `OFF`, or `Audio-Follow-Video`) directly from the dashboard.
- **Visual Aux Routing Matrix**: A beautiful crosspoint-style matrix that lets you click to route inputs and internal sources to your Auxiliary outputs.
- **Interactive Multiview Builder**:
  - Support for modern numeric grid layouts (Constellation/Extreme).
  - Support for legacy text layouts (Program Top / Program Bottom swaps).
  - Click on any Multiview window in the grid to re-assign its source.
- **Fairlight Audio Output Mapping**: Dynamically route audio sources to physical MADI, Aux, or HDMI outputs (on supported switchers).

---

## Getting Started

To run this locally or deploy it to the web, we use a lightweight Node.js Express server. Alternatively, you can try it live at https://atem-xml-editor.fly.dev/!

### Local Development
1. Install dependencies: `npm install`
2. Start the server: `npm start`
3. Open your browser to `http://localhost:8080`

### Usage
1. Open **ATEM Software Control**, go to `File > Save As`, and export your switcher state to an `.xml` file.
2. Open the Web Configurator in your browser (via your Fly.io URL or `localhost:8080`).
3. Drag and drop your `.xml` file into the "Overview" tab of the web dashboard.
4. Use the tabs on the left to configure your Labels, Multiviews, Auxiliaries, and Audio mapping.
5. Click **Export XML** in the top right corner.
6. In ATEM Software Control, go to `File > Restore` and select your newly downloaded file!

---

## For Developers

This project is built to be extremely fast and lightweight. It relies entirely on native browser APIs to parse and manipulate the XML Document Object Model (DOM) to ensure that the structure and specific Blackmagic schema remain perfectly intact.

### Tech Stack
- **Frontend**: Vanilla JavaScript (ES6), HTML5, CSS3.
- **Parser**: Native Browser `DOMParser` and `XMLSerializer`. 

### Contributing
Pull requests are welcome! If you are adding support for a new ATEM feature:
1. Ensure that the logic safely checks for the presence of the feature before rendering (e.g., checking if the switcher belongs to the ATEM Mini family before offering specific Multiview routing options).
2. Avoid using innerHTML inside loops when generating large tables to prevent O(N²) DOM reflow bottlenecks.
3. Use the `escapeHTML` utility when inserting user-defined labels to prevent UI breaking.
