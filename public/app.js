// --- GLOBAL STATE ---
let appState = {
  xmlDoc: null,
  productName: "",
  tier: "",
  generation: "legacy",
  audioEngine: "legacy",
  superSourceCount: 0,
  multiviewCount: 1,
  mvLayoutType: "text",
  hasSuperSource: false,
  hasFairlight: false,
  hasAudioMapping: false,
  hasMadi: false,
  hasIso: false,
  hasNetworkIngest: false,
  inputsMap: new Map(),
  mixOptionsMap: new Map(),
  activeMvIndex: null,
  activeWindowIndex: null,
  isLive: false,
};

// --- UTILS ---
function escapeHTML(str) {
  return str.replace(/[&<>'"]/g, 
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}

// --- NAVIGATION ---
document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.disabled) return;
    document
      .querySelectorAll(".nav-btn")
      .forEach((b) => b.classList.remove("active"));
    document
      .querySelectorAll(".tab-panel")
      .forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document
      .getElementById(btn.getAttribute("data-target"))
      .classList.add("active");
  });
});

// --- SUB-TAB NAVIGATION ---
function switchSubTab(btn, targetPanelId) {
  // Remove active class from sibling buttons and panels
  const tabBar = btn.parentElement;
  tabBar
    .querySelectorAll(".sub-tab-btn")
    .forEach((b) => b.classList.remove("active"));
  tabBar.parentElement
    .querySelectorAll(".sub-panel")
    .forEach((p) => p.classList.remove("active"));

  // Add active class to clicked button and target panel
  btn.classList.add("active");
  document.getElementById(targetPanelId).classList.add("active");
}

// --- FILE INGESTION ---
const dropZone = document.getElementById("drop-zone");
const fileInput = document.getElementById("file-input");

dropZone.addEventListener("click", () => fileInput.click());
dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("dragover");
});
dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("dragover");
});
dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  if (e.dataTransfer.files.length) processFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener("change", (e) => {
  if (e.target.files.length) processFile(e.target.files[0]);
});

function processFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => parseATEMXML(e.target.result);
  reader.readAsText(file);
}

// --- LIVE ATEM CONNECTION ---
function buildVirtualXML(state) {
  const doc = document.implementation.createDocument(null, "Profile", null);
  const root = doc.documentElement;
  root.setAttribute("majorVersion", "2");
  root.setAttribute("minorVersion", "2");
  
  const productName = (state.info && state.info.productIdentifier) ? state.info.productIdentifier : "ATEM Switcher";
  root.setAttribute("product", productName);

  const inputsNode = doc.createElement("Inputs");
  const outputsNode = doc.createElement("Outputs");
  
  if (state.inputs) {
    Object.values(state.inputs).forEach(inp => {
      const node = doc.createElement(inp.inputId >= 1000 ? "Output" : "Input");
      node.setAttribute("id", inp.inputId);
      node.setAttribute("longName", inp.longName || `Source ${inp.inputId}`);
      node.setAttribute("shortName", inp.shortName || `S${inp.inputId}`);
      
      if (inp.inputId >= 1000) {
        outputsNode.appendChild(node);
      } else {
        inputsNode.appendChild(node);
      }
    });
  }
  root.appendChild(inputsNode);
  root.appendChild(outputsNode);

  const auxNode = doc.createElement("Auxiliaries");
  if (state.video && state.video.auxilliaries) {
    state.video.auxilliaries.forEach((sourceId, index) => {
      if (sourceId !== undefined && sourceId !== null) {
        const node = doc.createElement("Auxiliary");
        node.setAttribute("id", index);
        node.setAttribute("input", sourceId);
        auxNode.appendChild(node);
      }
    });
  }
  root.appendChild(auxNode);

  appState.xmlDoc = doc;
}

// --- PARSER ---
function parseATEMXML(xmlString) {
  const parser = new DOMParser();
  appState.xmlDoc = parser.parseFromString(xmlString, "text/xml");



  analyzeATEMProfile(appState.xmlDoc);
  cacheInputNames();
  cacheAudioMixOptions();
  updateDashboardUI();
}

function analyzeATEMProfile(xmlDoc) {
  const profileNode = xmlDoc.querySelector("Profile");
  appState.productName = profileNode
    ? profileNode.getAttribute("product")
    : "Unknown ATEM";

  appState.hasAudioMapping =
    xmlDoc.querySelector("AudioMapping > AudioOutputs > Output") !== null ||
    xmlDoc.querySelector("AudioMapping AudioOutputs Output, AudioMapping > Output") !== null;

  appState.audioEngine = (xmlDoc.querySelector("FairlightAudioMixer") || appState.hasAudioMapping || appState.productName.includes("Constellation") || appState.productName.includes("Extreme"))
    ? "fairlight"
    : "legacy";
  appState.hasFairlight = appState.audioEngine === "fairlight";

  appState.superSourceCount = xmlDoc.querySelectorAll(
    "SuperSources > SuperSource",
  ).length;
  appState.hasSuperSource = appState.superSourceCount > 0;

  appState.hasMadi =
    appState.xmlDoc.querySelector("AudioMapping AudioOutputs Output[name^='MADI'], AudioMapping Output[name^='MADI']") !== null;
  appState.hasNetworkIngest =
    xmlDoc.querySelector("StreamingInputs") !== null ||
    appState.productName.includes("HD8");
  appState.hasIso =
    appState.productName.includes("ISO") ||
    xmlDoc.querySelector("RecordAllInputs") !== null;

  const sampleMV = xmlDoc.querySelector("MultiView");
  if (sampleMV) {
    appState.mvLayoutType = sampleMV.hasAttribute("LayoutID")
      ? "numeric"
      : "text";
    appState.generation = sampleMV.hasAttribute("LayoutID")
      ? "modern"
      : "legacy";
  } else {
    appState.mvLayoutType = "text";
    appState.generation = "legacy";
  }
  appState.multiviewCount = xmlDoc.querySelectorAll(
    "MultiViews > MultiView",
  ).length;

  if (appState.productName.includes("Constellation"))
    appState.tier = "Modern High-Density / MADI";
  else if (appState.productName.includes("Extreme"))
    appState.tier = "Advanced Streaming (Overlays)";
  else if (appState.productName.includes("Mini"))
    appState.tier = "Compact / Portable";
  else if (appState.productName.includes("Television Studio"))
    appState.tier = "Studio Production";
  else appState.tier = "Legacy / Classic Broadcast";
}

function cacheInputNames() {
  appState.inputsMap.clear();

  // 1. Cache standard inputs (Cameras, Media Players)
  const inputs = appState.xmlDoc.querySelectorAll("Inputs > Input");
  inputs.forEach((inp) => {
    appState.inputsMap.set(
      inp.getAttribute("id"),
      inp.getAttribute("longName") || inp.getAttribute("shortName"),
    );
  });

  // 2. Cache outputs (M/E 1-4, Clean Feeds, etc., which are routable to Multiviews)
  const outputs = appState.xmlDoc.querySelectorAll("Outputs > Output");
  outputs.forEach((out) => {
    appState.inputsMap.set(
      out.getAttribute("id"),
      out.getAttribute("longName") || out.getAttribute("shortName"),
    );
  });

  // Fallbacks just in case they are missing from the XML
  if (!appState.inputsMap.has("10010"))
    appState.inputsMap.set("10010", "Program");
  if (!appState.inputsMap.has("10011"))
    appState.inputsMap.set("10011", "Preview");
}

function cacheAudioMixOptions() {
  appState.mixOptionsMap.clear();
  
  if (appState.hasFairlight) {
    appState.xmlDoc.querySelectorAll("FairlightAudioMixer AudioInputs AudioInput").forEach(inp => {
      const src = inp.querySelector("AudioSource");
      if (src && src.hasAttribute("mixOption")) {
        appState.mixOptionsMap.set(inp.getAttribute("id"), src.getAttribute("mixOption"));
      }
    });
  } else {
    appState.xmlDoc.querySelectorAll("AudioMixer AudioInputs AudioInput").forEach(inp => {
      if (inp.hasAttribute("mixOption")) {
        appState.mixOptionsMap.set(inp.getAttribute("id"), inp.getAttribute("mixOption"));
      }
    });
  }
}

// --- UI RENDERERS ---
function updateDashboardUI() {
  document.getElementById("active-switcher-name").innerText =
    appState.productName;
  document.getElementById("info-model").innerText = appState.productName;
  document.getElementById("info-tier").innerText = appState.tier;
  document.getElementById("info-generation").innerText =
    appState.generation === "modern"
      ? "Modern (Numeric LayoutID)"
      : "Legacy (Text Layout)";
  document.getElementById("info-audio").innerText =
    appState.audioEngine === "fairlight"
      ? "Fairlight Audio Mixer"
      : "Legacy Audio Mixer";
  document.getElementById("info-ssrc-count").innerText =
    appState.superSourceCount > 0
      ? `${appState.superSourceCount} engine(s)`
      : "None";
  document.getElementById("info-mv-count").innerText =
    `${appState.multiviewCount} output(s)`;
  document.getElementById("info-mv-layout").innerText =
    appState.mvLayoutType === "numeric"
      ? "Numeric (LayoutID)"
      : "Text (layout attr)";

  document.getElementById("badge-ssrc").className =
    `badge ${appState.hasSuperSource}`;
  document.getElementById("badge-fairlight").className =
    `badge ${appState.hasFairlight}`;
  document.getElementById("badge-madi").className = `badge ${appState.hasMadi}`;
  document.getElementById("badge-iso").className = `badge ${appState.hasIso}`;
  document.getElementById("badge-net").className =
    `badge ${appState.hasNetworkIngest}`;

  document.getElementById("system-info").style.display = "inline-block";
  // Enable all nav buttons, then conditionally disable Audio Mapping
  document
    .querySelectorAll(".nav-btn")
    .forEach((btn) => (btn.disabled = false));
  const audioNav = document.getElementById("nav-audio");
  if (audioNav && (!appState.hasFairlight || !appState.hasAudioMapping)) {
    audioNav.disabled = true;
    audioNav.title = "Audio output routing is not available for this model";
  }

  buildLabelsTable();
  buildAuxMatrix();
  buildMultiview();
  buildAudioMapping();

  document.getElementById("nav-labels").click();
}

// 1. Labels Tables (Inputs & Outputs)
function buildLabelsTable() {
  // Inputs
  const inTbody = document.getElementById("inputs-table-body");
  inTbody.innerHTML = "";
  const inputs = appState.xmlDoc.querySelectorAll("Inputs > Input");

  inputs.forEach((input) => {
    const id = input.getAttribute("id");
    const shortName = escapeHTML(input.getAttribute("shortName") || "");
    const longName = escapeHTML(input.getAttribute("longName") || "");

    if (parseInt(id) < 1000) {
      // Look up audio mixOption for this input
      const mixOption = getAudioMixOption(id);

      const tr = document.createElement("tr");
      tr.innerHTML = `
                        <td>${id}</td>
                        <td><input type="text" value="${longName}" maxlength="20" onchange="updateXMLLabel('Inputs', '${id}', 'longName', this.value)"></td>
                        <td><input type="text" value="${shortName}" maxlength="4" onchange="updateXMLLabel('Inputs', '${id}', 'shortName', this.value)"></td>
                        <td>
                            <div class="audio-toggle" id="audio-toggle-${id}">
                                <button class="audio-toggle-btn ${mixOption === "On" ? "active-on" : ""}" onclick="updateAudioMixOption('${id}', 'On', this)" title="Audio always On">ON</button>
                                <button class="audio-toggle-btn ${mixOption === "AudioFollowVideo" ? "active-afv" : ""}" onclick="updateAudioMixOption('${id}', 'AudioFollowVideo', this)" title="Audio Follow Video">AFV</button>
                                <button class="audio-toggle-btn ${mixOption === "Off" ? "active-off" : ""}" onclick="updateAudioMixOption('${id}', 'Off', this)" title="Audio Off">OFF</button>
                            </div>
                        </td>
                    `;
      inTbody.appendChild(tr);
    }
  });

  // Outputs
  const outTbody = document.getElementById("outputs-table-body");
  if (outTbody) outTbody.innerHTML = "";
  const outputs = appState.xmlDoc.querySelectorAll("Outputs > Output");

  outputs.forEach((output) => {
    const id = output.getAttribute("id");
    const shortName = escapeHTML(output.getAttribute("shortName") || "");
    const longName = escapeHTML(output.getAttribute("longName") || "");

    const tr = document.createElement("tr");
    tr.innerHTML = `
                    <td>${id}</td>
                    <td><input type="text" value="${longName}" maxlength="20" onchange="updateXMLLabel('Outputs', '${id}', 'longName', this.value)"></td>
                    <td><input type="text" value="${shortName}" maxlength="4" onchange="updateXMLLabel('Outputs', '${id}', 'shortName', this.value)"></td>
                `;
    if (outTbody) outTbody.appendChild(tr);
  });
}

// Get the mixOption for a given input ID
function getAudioMixOption(inputId) {
  return appState.mixOptionsMap.get(inputId) || "unknown";
}

// Set the mixOption for a given input ID and update button styles
function updateAudioMixOption(inputId, newValue, clickedBtn) {
  // Fairlight path
  const fairlightSource = appState.xmlDoc.querySelector(
    `FairlightAudioMixer AudioInputs AudioInput[id="${inputId}"] AudioSource`,
  );
  if (fairlightSource) {
    fairlightSource.setAttribute("mixOption", newValue);
  }

  // Legacy path
  const legacyInput = appState.xmlDoc.querySelector(
    `AudioMixer AudioInputs AudioInput[id="${inputId}"]`,
  );
  if (legacyInput) {
    legacyInput.setAttribute("mixOption", newValue);
  }
  
  appState.mixOptionsMap.set(inputId, newValue);

  // Update button states in the toggle group
  const toggleGroup = clickedBtn.parentElement;
  toggleGroup.querySelectorAll(".audio-toggle-btn").forEach((btn) => {
    btn.className = "audio-toggle-btn";
  });

  if (newValue === "On") clickedBtn.className = "audio-toggle-btn active-on";
  else if (newValue === "AudioFollowVideo")
    clickedBtn.className = "audio-toggle-btn active-afv";
  else if (newValue === "Off")
    clickedBtn.className = "audio-toggle-btn active-off";
}

// Universal XML updater for both Inputs and Outputs
function updateXMLLabel(nodeType, id, attrName, newValue) {
  const nodeName = nodeType === "Inputs" ? "Input" : "Output";
  const node = appState.xmlDoc.querySelector(
    `${nodeType} > ${nodeName}[id="${id}"]`,
  );
  if (node) {
    node.setAttribute(attrName, newValue);
    if (nodeType === "Inputs") {
      cacheInputNames(); // Refresh map for aux routing column headers
    }
  }

}

// 2. Aux Crosspoint Matrix (Split into Inputs and Outputs)
function buildAuxMatrix() {
  const inTable = document.getElementById("aux-inputs-matrix-table");
  const outTable = document.getElementById("aux-outputs-matrix-table");
  if (inTable) inTable.innerHTML = "";
  if (outTable) outTable.innerHTML = "";

  const auxes = Array.from(
    appState.xmlDoc.querySelectorAll("Auxiliaries > Auxiliary"),
  );
  if (auxes.length === 0) {
    if (inTable)
      inTable.innerHTML =
        "<tr><td>No Auxiliary outputs found on this model.</td></tr>";
    return;
  }

  // --- INPUTS MATRIX ---
  const inputIds = Array.from(
    appState.xmlDoc.querySelectorAll("Inputs > Input"),
  ).map((inp) => inp.getAttribute("id"));

  let inHeaderHTML = "<thead><tr><th>Outputs \\ Inputs</th>";
  inputIds.forEach((id) => {
    inHeaderHTML += `<th>${escapeHTML(appState.inputsMap.get(id) || "ID: " + id)}</th>`;
  });
  inHeaderHTML += "</tr></thead><tbody>";

  // --- OUTPUTS MATRIX ---
  const outputIds = Array.from(
    appState.xmlDoc.querySelectorAll("Outputs > Output"),
  ).map((out) => out.getAttribute("id"));

  let outHeaderHTML = "<thead><tr><th>Outputs \\ Internal Sources</th>";
  outputIds.forEach((id) => {
    outHeaderHTML += `<th>${escapeHTML(appState.inputsMap.get(id) || "ID: " + id)}</th>`;
  });
  outHeaderHTML += "</tr></thead><tbody>";

  // --- POPULATE ROWS ---
  let inBodyHTML = "";
  let outBodyHTML = "";

  auxes.forEach((aux, i) => {
    const auxId = aux.getAttribute("id");
    const currentInput = aux.getAttribute("input");

    // Lookup the assigned output name, fallback to "Aux + ID" if blank
    const auxName = appState.inputsMap.get(auxId) || `Aux ${auxId}`;

    // Inputs row
    let inRow = `<tr><td>${escapeHTML(auxName)}</td>`;
    inputIds.forEach((inId) => {
      const isChecked = currentInput === inId ? "checked" : "";
      const uniqueId = `aux_in_${auxId}_${inId}`;
      inRow += `
                        <td>
                            <input type="radio" class="cp-radio" name="auxgrp_${auxId}" id="${uniqueId}" ${isChecked} onchange="updateAux('${auxId}', '${inId}', ${i})">
                            <label class="cp-label" for="${uniqueId}" title="Route ${escapeHTML(appState.inputsMap.get(inId))} to ${escapeHTML(auxName)}"></label>
                        </td>
                    `;
    });
    inRow += `</tr>`;
    inBodyHTML += inRow;

    // Outputs row
    let outRow = `<tr><td>${escapeHTML(auxName)}</td>`;
    outputIds.forEach((outId) => {
      const isChecked = currentInput === outId ? "checked" : "";
      const uniqueId = `aux_out_${auxId}_${outId}`;
      outRow += `
                        <td>
                            <input type="radio" class="cp-radio" name="auxgrp_${auxId}" id="${uniqueId}" ${isChecked} onchange="updateAux('${auxId}', '${outId}', ${i})">
                            <label class="cp-label" for="${uniqueId}" title="Route ${escapeHTML(appState.inputsMap.get(outId))} to ${escapeHTML(auxName)}"></label>
                        </td>
                    `;
    });
    outRow += `</tr>`;
    outBodyHTML += outRow;
  });

  if (inTable) inTable.innerHTML = inHeaderHTML + inBodyHTML + "</tbody>";
  if (outTable) outTable.innerHTML = outHeaderHTML + outBodyHTML + "</tbody>";
}

function updateAux(auxId, newInputId, auxIndex) {
  const auxNode = appState.xmlDoc.querySelector(
    `Auxiliaries > Auxiliary[id="${auxId}"]`,
  );
  if (auxNode) auxNode.setAttribute("input", newInputId);

  // Live Control Push

}

// 4. Audio Mapping — per-output channel routing (Constellation / Fairlight)
// Real ATEM 8K structure: AudioMapping > AudioOutputs > Output (flat, each has sourceId + name)
// Outputs grouped by name prefix (e.g. "MADI1", "Aux1", "Aux2")
function buildAudioMapping() {
  const tabBar = document.getElementById("audio-output-tabs");
  const panelsContainer = document.getElementById("audio-panels-container");
  if (!tabBar || !panelsContainer) return;
  tabBar.innerHTML = "";
  panelsContainer.innerHTML = "";

  if (!appState.hasFairlight) {
    panelsContainer.innerHTML =
      '<div class="audio-map-empty">Audio mapping is not available for this model.<br>This feature requires a Fairlight-class audio engine (e.g. Constellation series).</div>';
    return;
  }

  // Discover outputs: AudioMapping > AudioOutputs > Output (Constellation 8K format)
  let audioOutputNodes = Array.from(
    appState.xmlDoc.querySelectorAll("AudioMapping > AudioOutputs > Output"),
  );
  // Fallback selectors for other possible structures
  if (audioOutputNodes.length === 0) {
    audioOutputNodes = Array.from(
      appState.xmlDoc.querySelectorAll(
        "AudioMapping AudioOutputs Output, AudioMapping > Output",
      ),
    );
  }

  if (audioOutputNodes.length === 0) {
    panelsContainer.innerHTML =
      '<div class="audio-map-empty">No <code>&lt;AudioMapping&gt; &lt;AudioOutputs&gt;</code> found in this XML.<br>This model may not expose audio output routing in its configuration file.</div>';
    return;
  }

  // Collect available audio sources from AudioMapping > AudioSources > Source
  const audioSources = collectAudioSources();

  // Group outputs by name prefix (e.g. "MADI1", "Aux1", "Aux2", ...)
  const groups = new Map();
  audioOutputNodes.forEach((node) => {
    const name = node.getAttribute("name") || "";
    // Extract group prefix: everything before the last space + channel pair
    // e.g. "Aux1 1/2" => "Aux1", "MADI1 15 1/2" => "MADI1 15" ... actually we want "MADI1"
    // Pattern: extract the alphabetic+numeric prefix before the channel pair
    const match = name.match(/^(.+?)\s+\d+\/\d+$/);
    const groupKey = match ? match[1] : name;

    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(node);
  });

  let tabIdx = 0;
  groups.forEach((outputs, groupName) => {
    const currentIdx = tabIdx++;

    // Resolve "actual name" for Auxiliaries
    let displayName = groupName;
    const auxMatch = groupName.match(/^Aux(\d+)$/i);
    if (auxMatch) {
      const auxId = 8000 + parseInt(auxMatch[1], 10);
      const actualName = appState.inputsMap.get(auxId.toString());
      if (actualName) {
        displayName = actualName;
      }
    }

    // Tab button
    const btn = document.createElement("button");
    btn.className = "audio-output-tab" + (currentIdx === 0 ? " active" : "");
    btn.textContent = displayName;
    btn.setAttribute("data-audio-idx", currentIdx);
    btn.addEventListener("click", () => switchAudioOutputTab(currentIdx));
    tabBar.appendChild(btn);

    // Panel
    const panel = document.createElement("div");
    panel.className =
      "audio-output-panel" + (currentIdx === 0 ? " active" : "");
    panel.id = `audio-panel-${currentIdx}`;

    const section = document.createElement("div");
    section.className = "audio-map-section";

    // Determine type badge from name
    let typeBadge = "SDI";
    if (groupName.toLowerCase().includes("madi")) typeBadge = "MADI";
    else if (groupName.toLowerCase().includes("aux")) typeBadge = "AUX";
    else if (groupName.toLowerCase().includes("hdmi")) typeBadge = "HDMI";

    section.innerHTML = `<h3>${escapeHTML(displayName)} <span class="output-badge">${typeBadge}</span> <span style="font-size:0.75rem; color:var(--text-muted); font-weight:normal; margin-left:auto;">${outputs.length} channel pair(s)</span></h3>`;

    const grid = document.createElement("div");
    grid.className = "audio-channel-grid";

    outputs.forEach((outputNode) => {
      const chName = outputNode.getAttribute("name") || "Unknown";
      const currentSourceId = outputNode.getAttribute("sourceId") || "0";

      const row = document.createElement("div");
      row.className = "audio-channel-row";

      const label = document.createElement("label");
      // Show just the channel pair part (e.g. "1/2" from "Aux1 1/2")
      const pairMatch = chName.match(/(\d+\/\d+)$/);
      label.textContent = pairMatch ? pairMatch[1] : chName;
      label.title = chName;
      row.appendChild(label);

      const select = document.createElement("select");

      audioSources.forEach((src) => {
        const opt = document.createElement("option");
        opt.value = src.id;
        opt.textContent = src.label;
        if (src.id === currentSourceId) opt.selected = true;
        select.appendChild(opt);
      });

      select.addEventListener("change", () => {
        outputNode.setAttribute("sourceId", select.value);
        
      });

      row.appendChild(select);
      grid.appendChild(row);
    });

    section.appendChild(grid);
    panel.appendChild(section);
    panelsContainer.appendChild(panel);
  });
}

// Collect all routable audio sources from AudioMapping > AudioSources > Source
function collectAudioSources() {
  const sources = [];
  const seen = new Set();

  // Primary: AudioMapping > AudioSources > Source (Constellation 8K format)
  appState.xmlDoc
    .querySelectorAll(
      "AudioMapping > AudioSources > Source, AudioMapping AudioSources Source",
    )
    .forEach((src) => {
      const id = src.getAttribute("id");
      let name = src.getAttribute("name") || `Source ${id}`;
      
      // Map generic "Input X" names to their actual user-defined names
      const inputMatch = name.match(/^Input\s+(\d+)(.*)$/i);
      if (inputMatch) {
        const physicalId = inputMatch[1];
        const actualName = appState.inputsMap.get(physicalId);
        if (actualName) {
          name = `${actualName} ${inputMatch[2].trim()}`.trim();
        }
      }

      if (id && !seen.has(id)) {
        seen.add(id);
        sources.push({ id, label: name });
      }
    });

  // If we got sources from AudioSources, return early — they're the authoritative list
  if (sources.length > 0) return sources;

  // Fallback: build from Fairlight + standard inputs
  const fairlightInputs = appState.xmlDoc.querySelectorAll(
    "FairlightAudioMixer > Inputs > Input, FairlightAudioMixer Input",
  );
  fairlightInputs.forEach((inp) => {
    const id = inp.getAttribute("id") || inp.getAttribute("index");
    if (id && !seen.has(id)) {
      seen.add(id);
      const name =
        appState.inputsMap.get(id) ||
        inp.getAttribute("name") ||
        `Fairlight Input ${id}`;
      sources.push({ id, label: name });
    }
  });

  appState.xmlDoc.querySelectorAll("Inputs > Input").forEach((inp) => {
    const id = inp.getAttribute("id");
    if (id && !seen.has(id)) {
      seen.add(id);
      sources.push({ id, label: appState.inputsMap.get(id) || `Input ${id}` });
    }
  });

  return sources;
}

function switchAudioOutputTab(idx) {
  document.querySelectorAll(".audio-output-tab").forEach((btn) => {
    btn.classList.toggle(
      "active",
      parseInt(btn.getAttribute("data-audio-idx")) === idx,
    );
  });
  document.querySelectorAll(".audio-output-panel").forEach((panel) => {
    panel.classList.remove("active");
  });
  const target = document.getElementById(`audio-panel-${idx}`);
  if (target) target.classList.add("active");
}

// 3. Multiview Generator (With Layout Controls)
function buildMultiview() {
  const tabBar = document.getElementById("mv-tab-bar");
  const panelsContainer = document.getElementById("mv-panels-container");
  tabBar.innerHTML = "";
  panelsContainer.innerHTML = "";

  const multiviews = appState.xmlDoc.querySelectorAll("MultiViews > MultiView");
  if (multiviews.length === 0) {
    panelsContainer.innerHTML =
      '<p style="color:var(--text-muted)">No Multiview outputs found in this XML.</p>';
    return;
  }

  multiviews.forEach((mv, mvIdx) => {
    const btn = document.createElement("button");
    btn.className = "mv-tab-btn" + (mvIdx === 0 ? " active" : "");
    btn.textContent = `Multiview ${mvIdx + 1}`;
    btn.setAttribute("data-mv-index", mvIdx);
    btn.addEventListener("click", () => switchMultiviewTab(mvIdx));
    tabBar.appendChild(btn);

    const panel = document.createElement("div");
    panel.className = "mv-single-view" + (mvIdx === 0 ? " active" : "");
    panel.id = `mv-panel-${mvIdx}`;

    // --- LAYOUT CONTROLS UI ---
    const controlsDiv = document.createElement("div");
    controlsDiv.className = "layout-controls";

    let currentLayout =
      mv.getAttribute("LayoutID") ||
      mv.getAttribute("layout") ||
      (appState.generation === "modern" ? "15" : "ProgramTop");

    if (appState.generation === "modern") {
      const layoutId = parseInt(currentLayout) || 15;
      controlsDiv.innerHTML = `
                        <label>Enable Quadrant Split:</label>
                        <div class="quad-toggles">
                            <label class="quad-toggle"><input type="checkbox" onchange="updateModernLayout(${mvIdx}, 1, this.checked)" ${layoutId & 1 ? "checked" : ""}> Top Left</label>
                            <label class="quad-toggle"><input type="checkbox" onchange="updateModernLayout(${mvIdx}, 2, this.checked)" ${layoutId & 2 ? "checked" : ""}> Top Right</label>
                            <label class="quad-toggle"><input type="checkbox" onchange="updateModernLayout(${mvIdx}, 4, this.checked)" ${layoutId & 4 ? "checked" : ""}> Bottom Left</label>
                            <label class="quad-toggle"><input type="checkbox" onchange="updateModernLayout(${mvIdx}, 8, this.checked)" ${layoutId & 8 ? "checked" : ""}> Bottom Right</label>
                        </div>
                    `;
    } else {
      const isSwapped = mv.getAttribute("programPreviewSwapped") === "True";
      controlsDiv.innerHTML = `
                        <label>Legacy Layout:</label>
                        <select onchange="updateLegacyLayout(${mvIdx}, this.value)" style="padding: 5px; background: var(--bg-dark); color: var(--text-main); border: 1px solid var(--border); border-radius: 4px; margin-right: 15px;">
                            <option value="ProgramTop" ${currentLayout === "ProgramTop" ? "selected" : ""}>Program Top</option>
                            <option value="ProgramBottom" ${currentLayout === "ProgramBottom" ? "selected" : ""}>Program Bottom</option>
                        </select>
                        <label class="quad-toggle">
                            <input type="checkbox" onchange="updateLegacySwapped(${mvIdx}, this.checked)" ${isSwapped ? "checked" : ""}> Swap Program / Preview
                        </label>
                    `;
    }
    panel.appendChild(controlsDiv);

    // --- GRID RENDERING ---
    const grid = document.createElement("div");
    grid.className = "mv-preview";

    const windowsMap = new Map();
    mv.querySelectorAll("Windows > Window").forEach((win) => {
      windowsMap.set(
        parseInt(win.getAttribute("index")),
        win.getAttribute("input"),
      );
    });

    if (appState.generation === "modern") {
      grid.classList.add("mv-grid-modern");
      const layoutId = parseInt(currentLayout) || 15;

      // ATEM 4x4 Grid mapping logic to Quadrant Bits
      const quadMap = {
        0: 0,
        1: 0,
        4: 0,
        5: 0,
        2: 1,
        3: 1,
        6: 1,
        7: 1,
        8: 2,
        9: 2,
        12: 2,
        13: 2,
        10: 3,
        11: 3,
        14: 3,
        15: 3,
      };
      const primaryBoxes = [0, 2, 8, 10]; // The boxes that stay active when quadrant is UNSPLIT

      for (let i = 0; i < 16; i++) {
        const div = document.createElement("div");
        div.className = "mv-box";

        const quadIndex = quadMap[i];
        const bitVal = Math.pow(2, quadIndex);
        const isSplit = (layoutId & bitVal) !== 0;
        const isPrimary = primaryBoxes.includes(i);

        if (!isSplit) {
          if (isPrimary) div.classList.add("mv-win-large");
          else div.classList.add("mv-hidden");
        }

        const inputId = windowsMap.get(i) || "0";
        const name = appState.inputsMap.get(inputId) || `Input ${inputId}`;

        div.innerHTML = `<span class="box-label">Window ${i + 1}</span> <span style="text-align:center;">${escapeHTML(name)}</span>`;

        if (!div.classList.contains("mv-hidden")) {
          div.addEventListener("click", () => openMultiviewModal(mvIdx, i));
        }
        grid.appendChild(div);
      }
    } else {
      const isSwapped = mv.getAttribute("programPreviewSwapped") === "True";
      grid.classList.add(
        currentLayout === "ProgramBottom"
          ? "mv-layout-programbottom"
          : "mv-layout-programtop",
      );
      if (isSwapped) grid.classList.add("swapped");

      for (let i = 0; i < 10; i++) {
        const div = document.createElement("div");
        div.className = "mv-box";
        if (i === 0) div.classList.add("mv-pvw"); // Index 0 is Preview
        if (i === 1) div.classList.add("mv-pgm"); // Index 1 is Program

        const inputId = windowsMap.get(i) || "0";
        const name = appState.inputsMap.get(inputId) || `Input ${inputId}`;

        if (i === 0 || i === 1) {
          // Locked for legacy switchers
          div.innerHTML = `<span>${escapeHTML(name)}</span>`;
          div.style.pointerEvents = "none"; // Lock hover/click visually
        } else {
          div.innerHTML = `<span class="box-label">Window ${i + 1}</span> <span style="text-align:center;">${escapeHTML(name)}</span>`;
          div.addEventListener("click", () => openMultiviewModal(mvIdx, i));
        }

        grid.appendChild(div);
      }
    }

    panel.appendChild(grid);
    panelsContainer.appendChild(panel);
  });
}

// --- LAYOUT UPDATE HELPERS ---
function updateModernLayout(mvIdx, bitMask, isChecked) {
  const mvNode = appState.xmlDoc.querySelectorAll("MultiViews > MultiView")[
    mvIdx
  ];
  let currentId = parseInt(mvNode.getAttribute("LayoutID") || 15);

  // Modify the bitmask based on the toggle
  if (isChecked) currentId |= bitMask;
  else currentId &= ~bitMask;

  mvNode.setAttribute("LayoutID", currentId);
  buildMultiview(); // Visually refresh the grid
  switchMultiviewTab(mvIdx); // Keep the user on the current tab

  
}

function updateLegacyLayout(mvIdx, layoutName) {
  const mvNode = appState.xmlDoc.querySelectorAll("MultiViews > MultiView")[
    mvIdx
  ];
  mvNode.setAttribute("layout", layoutName);
  buildMultiview(); // Visually refresh the grid
  switchMultiviewTab(mvIdx); // Keep the user on the current tab

}

function updateLegacySwapped(mvIdx, isSwapped) {
  const mvNode = appState.xmlDoc.querySelectorAll("MultiViews > MultiView")[
    mvIdx
  ];
  mvNode.setAttribute("programPreviewSwapped", isSwapped ? "True" : "False");
  buildMultiview(); // Visually refresh the grid
  switchMultiviewTab(mvIdx); // Keep the user on the current tab

  
}

function switchMultiviewTab(mvIdx) {
  document.querySelectorAll(".mv-tab-btn").forEach((btn) => {
    btn.classList.toggle(
      "active",
      parseInt(btn.getAttribute("data-mv-index")) === mvIdx,
    );
  });
  document.querySelectorAll(".mv-single-view").forEach((panel) => {
    panel.classList.remove("active");
  });
  const target = document.getElementById(`mv-panel-${mvIdx}`);
  if (target) target.classList.add("active");
}

// --- MULTIVIEW ROUTING MODAL ---
function openMultiviewModal(mvIdx, winIdx) {
  appState.activeMvIndex = mvIdx;
  appState.activeWindowIndex = winIdx;

  document.getElementById("mv-modal-target").innerText =
    `Editing: Multiview ${mvIdx + 1} - Window ${winIdx + 1}`;
  const select = document.getElementById("mv-source-select");
  select.innerHTML = "";

  // Build Inputs Group
  const inGroup = document.createElement("optgroup");
  inGroup.label = "--- Physical & Virtual Inputs ---";
  const inputs = appState.xmlDoc.querySelectorAll("Inputs > Input");
  inputs.forEach((inp) => {
    const id = inp.getAttribute("id");
    if (parseInt(id) < 1000) {
      const option = document.createElement("option");
      option.value = id;
      option.text = `[${id}] ${appState.inputsMap.get(id)}`;
      inGroup.appendChild(option);
    }
  });
  select.appendChild(inGroup);

  // Build Outputs Group
  const outGroup = document.createElement("optgroup");
  outGroup.label = "--- Outputs & Internal Sources ---";
  const outputs = appState.xmlDoc.querySelectorAll("Outputs > Output");
  outputs.forEach((out) => {
    const id = out.getAttribute("id");
    
    // ATEM compact switchers (Mini, SDI, Extreme) cannot route MV into MV at all.
    // Also universally, a Multiview engine cannot be routed into itself.
    const isCompactFamily = appState.productName.includes("Mini") || appState.productName.includes("Extreme") || appState.productName.includes("SDI");
    const isMvSource = parseInt(id) >= 9000 && parseInt(id) < 9100;
    
    if (isMvSource) {
      if (isCompactFamily) return; // Hide all MVs for compact models
      if (parseInt(id) === 9001 + mvIdx) return; // Prevent recursive routing (MV1 into MV1)
    }

    const option = document.createElement("option");
    option.value = id;
    option.text = `[${id}] ${appState.inputsMap.get(id)}`;
    outGroup.appendChild(option);
  });
  select.appendChild(outGroup);

  // Pre-select the current source
  const mvNode = appState.xmlDoc.querySelectorAll("MultiViews > MultiView")[
    mvIdx
  ];
  const winNode = mvNode.querySelector(`Windows > Window[index="${winIdx}"]`);
  if (winNode) select.value = winNode.getAttribute("input");

  // Open the native HTML dialog
  document.getElementById("mv-modal").showModal();
}

function saveMultiviewSource() {
  const select = document.getElementById("mv-source-select");
  const newVal = select.value;

  const mvNode = appState.xmlDoc.querySelectorAll("MultiViews > MultiView")[
    appState.activeMvIndex
  ];
  const winNode = mvNode.querySelector(
    `Windows > Window[index="${appState.activeWindowIndex}"]`,
  );

  if (winNode) {
    winNode.setAttribute("input", newVal);
    buildMultiview(); // Re-render the grid
    switchMultiviewTab(appState.activeMvIndex); // Ensure we stay on the same Multiview tab
  }

  

  document.getElementById("mv-modal").close();
}

// --- EXPORT ---
function exportXML() {
  if (!appState.xmlDoc) {
    alert("Please upload an XML file first.");
    return;
  }
  const serializer = new XMLSerializer();
  const xmlString = serializer.serializeToString(appState.xmlDoc);

  const blob = new Blob([xmlString], { type: "text/xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Patched_${appState.productName.replace(/[^a-z0-9]/gi, "_")}.xml`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
