// --- GLOBAL STATE ---
let appState = {
  xmlDoc: null,
  originalXmlString: null,
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
  // Find the enclosing tab-panel container (e.g. #tab-labels or #tab-aux)
  const tabContainer = btn.closest(".tab-panel") || document;
  const tabBar = btn.closest(".sub-tab-bar") || btn.parentElement;

  // Remove active class from sibling buttons and panels within this tab
  tabBar
    .querySelectorAll(".sub-tab-btn")
    .forEach((b) => b.classList.remove("active"));
  tabContainer
    .querySelectorAll(".sub-panel")
    .forEach((p) => p.classList.remove("active"));

  // Add active class to clicked button and target panel
  btn.classList.add("active");
  const target = document.getElementById(targetPanelId);
  if (target) {
    target.classList.add("active");
  }
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
/**
 * Builds a virtual BMD XML Document from live ATEM hardware state received via WebSocket.
 * Complies with strict ATEM Software Control schema (majorVersion=2, minorVersion=1,
 * Settings parent node, and 8001+ Auxiliary output IDs).
 * @param {object} state - Hardware state emitted by the ATEM proxy
 */
function buildVirtualXML(state) {
  const doc = document.implementation.createDocument(null, "Profile", null);
  const root = doc.documentElement;
  root.setAttribute("majorVersion", "2");
  root.setAttribute("minorVersion", "1");
  
  const productName = (state.info && state.info.productIdentifier) ? state.info.productIdentifier : "ATEM Switcher";
  root.setAttribute("product", productName);

  // Settings container (strict parent for Inputs and Outputs in BMD XML schema)
  const settingsNode = doc.createElement("Settings");
  settingsNode.setAttribute("abDirect", "False");
  settingsNode.setAttribute("cameraAux", "-1");
  settingsNode.setAttribute("SDI3GOutputLevel", "LevelA");
  root.appendChild(settingsNode);

  const inputsNode = doc.createElement("Inputs");
  const outputsNode = doc.createElement("Outputs");
  
  if (state.inputs) {
    Object.values(state.inputs).forEach(inp => {
      const isInternal = inp.inputId >= 1000;
      const node = doc.createElement(isInternal ? "Output" : "Input");
      node.setAttribute("id", inp.inputId.toString());
      node.setAttribute("longName", inp.longName || (isInternal ? `Output ${inp.inputId}` : `Camera ${inp.inputId}`));
      node.setAttribute("shortName", inp.shortName || (isInternal ? `Out${inp.inputId}` : `Cam${inp.inputId}`));
      
      if (isInternal) {
        outputsNode.appendChild(node);
      } else {
        inputsNode.appendChild(node);
      }
    });
  }
  settingsNode.appendChild(inputsNode);
  settingsNode.appendChild(outputsNode);

  // Auxiliaries are top-level Profile children (IDs start at 8001 = Aux 1)
  const auxNode = doc.createElement("Auxiliaries");
  if (state.video && state.video.auxilliaries) {
    state.video.auxilliaries.forEach((sourceId, index) => {
      if (sourceId !== undefined && sourceId !== null) {
        const node = doc.createElement("Auxiliary");
        node.setAttribute("id", (8001 + index).toString());
        node.setAttribute("input", sourceId.toString());
        auxNode.appendChild(node);
      }
    });
  }
  root.appendChild(auxNode);

  appState.xmlDoc = doc;
}
// --- CREATE FROM SCRATCH ---
/**
 * Populates the model selection dropdown with all known ATEM hardware models
 * and their official Blackmagic Design product names.
 */
function initCreateFromScratch() {
  const select = document.getElementById("model-select");
  if (!select) return;
  select.innerHTML = '<option value="">-- Choose an ATEM Switcher Model --</option>';

  // Sort models nicely: Auto Detect first, then alphabetical by official XML product name
  const entries = Object.entries(MODEL_CAPABILITIES).filter(([name]) => name !== "Auto Detect");
  entries.sort((a, b) => (a[1].xmlProductName || a[0]).localeCompare(b[1].xmlProductName || b[0]));

  for (const [modelName, caps] of entries) {
    const option = document.createElement("option");
    option.value = modelName;
    option.textContent = caps.xmlProductName || modelName;
    select.appendChild(option);
  }
}

/**
 * Generates a clean, valid Blackmagic Design ATEM XML profile tree from scratch
 * matching the selected model's physical capabilities from the Companion database.
 */
function handleCreateFromScratch() {
  const select = document.getElementById("model-select");
  const modelName = select.value;
  if (!modelName) {
    alert("Please select a model first.");
    return;
  }
  
  const caps = typeof findModelCapabilities === 'function' 
    ? findModelCapabilities(modelName) 
    : MODEL_CAPABILITIES[modelName];
  if (!caps) return;

  const doc = document.implementation.createDocument(null, "Profile", null);
  const root = doc.documentElement;
  root.setAttribute("majorVersion", "2");
  root.setAttribute("minorVersion", "1");
  
  // Enforce the exact official XML product name required by ATEM Software Control
  const pName = caps.xmlProductName || ("ATEM " + modelName);
  root.setAttribute("product", pName);

  // Settings container (required parent element for Inputs, Outputs, and MultiViews)
  const settingsNode = doc.createElement("Settings");
  settingsNode.setAttribute("abDirect", "False");
  settingsNode.setAttribute("cameraAux", "-1");
  settingsNode.setAttribute("SDI3GOutputLevel", "LevelB");
  settingsNode.setAttribute("ftbEnabled", "True");
  settingsNode.setAttribute("dskTallyOverride", "False");
  root.appendChild(settingsNode);

  // Inputs & Outputs
  const outputsNode = doc.createElement("Outputs");
  if (caps.inputs > 0) {
    const inputsNode = doc.createElement("Inputs");
    for (let i = 1; i <= caps.inputs; i++) {
      const node = doc.createElement("Input");
      node.setAttribute("id", i);
      node.setAttribute("shortName", `Cam${i}`);
      node.setAttribute("longName", `Camera ${i}`);
      inputsNode.appendChild(node);
    }
  
    if (caps.audioRoutingSources) {
      caps.audioRoutingSources.forEach(src => {
          if (src.sourceName && src.sourceName.includes("Thunderbolt")) {
              const node = doc.createElement("Input");
              node.setAttribute("id", src.inputId.toString());
              node.setAttribute("shortName", "TB"); 
              node.setAttribute("longName", src.sourceName);
              inputsNode.appendChild(node);
          }
      });
    }
    settingsNode.appendChild(inputsNode);
  }

  // Generate basic internal outputs so they appear in Labels tab
  const defaultOutputs = [
      { id: "0", longName: "Black", shortName: "BLK" },
      { id: "1000", longName: "Color Bars", shortName: "BARS" }
  ];

  const meCount = caps.mes || 1;
  const mpCount = meCount >= 2 ? 4 : 2;

  for (let i = 1; i <= 2; i++) {
      defaultOutputs.push({ id: (2000 + i).toString(), longName: `Color ${i}`, shortName: `COL${i}` });
  }
  for (let i = 1; i <= mpCount; i++) {
      let offset = (i - 1) * 10;
      defaultOutputs.push({ id: (3010 + offset).toString(), longName: `Media Player ${i}`, shortName: `MP${i}` });
      defaultOutputs.push({ id: (3011 + offset).toString(), longName: `Media Player ${i} Key`, shortName: `MP${i}K` });
  }
  for (let i = 1; i <= meCount; i++) {
      let offset = (i - 1) * 10;
      defaultOutputs.push({ id: (10010 + offset).toString(), longName: meCount === 1 ? "Program" : `ME ${i}`, shortName: meCount === 1 ? "PGM" : `M/E${i}` });
      defaultOutputs.push({ id: (10011 + offset).toString(), longName: meCount === 1 ? "Preview" : `ME ${i} PVW`, shortName: meCount === 1 ? "PVW" : `PVW${i}` });
  }
  
  const cfCount = Math.max(2, meCount); // Usually 2 on 1M/E, 4 on 4M/E
  for (let i = 1; i <= cfCount; i++) {
      defaultOutputs.push({ id: (7000 + i).toString(), longName: `Clean Feed ${i}`, shortName: `CFD${i}` });
  }

  const ssrcCount = caps.ssrcCount || (caps.hasSuperSource ? 1 : 0);
  if (ssrcCount > 0) {
      for (let i = 1; i <= ssrcCount; i++) {
          defaultOutputs.push({ id: (6000 + i - 1).toString(), longName: ssrcCount > 1 ? `SuperSource ${i}` : "SuperSource", shortName: ssrcCount > 1 ? `SS${i}` : "SSRC" });
      }
  }
  
  if (caps.multiviews > 0) {
      for (let i = 1; i <= caps.multiviews; i++) {
          defaultOutputs.push({ id: (9000 + i).toString(), longName: `Multiview ${i}`, shortName: `MV${i}` });
      }
  }

  // Auxiliaries
  if (caps.routingOutputs && caps.routingOutputs.length > 0) {
    const auxNode = doc.createElement("Auxiliaries");
    caps.routingOutputs.forEach((outInfo, i) => {
      let id = (8001 + i).toString();
      let defaultLabel = outInfo.name || `Auxiliary ${i+1}`;
      let defaultShort = `Ax${i+1}`;
      
      const nLower = defaultLabel.toLowerCase();
      if (nLower.includes("webcam") || nLower.includes("thunderbolt")) {
          const count = caps.routingOutputs.slice(0, i).filter(o => o.name.toLowerCase().includes("webcam") || o.name.toLowerCase().includes("thunderbolt")).length;
          id = (8200 + count).toString();
          defaultShort = nLower.includes("thunderbolt") ? `TB${count+1}` : `WEBC`;
      }
      
      const node = doc.createElement("Auxiliary");
      node.setAttribute("id", id);
      node.setAttribute("input", "10010"); // Program by default
      auxNode.appendChild(node);
      
      defaultOutputs.push({ id: id, longName: defaultLabel, shortName: defaultShort });
    });
    root.appendChild(auxNode);
  } else if (caps.aux > 0) {
    const auxNode = doc.createElement("Auxiliaries");
    for (let i = 0; i < caps.aux; i++) {
      let id = (8001 + i).toString();
      let defaultLabel = `Auxiliary ${i+1}`;
      let defaultShort = `Ax${i+1}`;
      
      // Fallback for older models without routingOutputs
      const isMiniSDI = pName.includes("Mini") || pName.includes("SDI");
      if (isMiniSDI && i === caps.aux - 1) {
          id = "8200";
          if (pName.includes("G2")) {
              defaultLabel = "Thunderbolt 1";
              defaultShort = "TB1";
          } else {
              defaultLabel = "USB Webcam Out";
              defaultShort = "WEBC";
          }
      }
      
      // Aux Routing
      const node = doc.createElement("Auxiliary");
      node.setAttribute("id", id);
      node.setAttribute("input", "10010"); // Program by default
      auxNode.appendChild(node);
      
      // Aux Naming
      defaultOutputs.push({ id: id, longName: defaultLabel, shortName: defaultShort });
    }
    root.appendChild(auxNode);
  }

  // Append Outputs node
  defaultOutputs.forEach(out => {
      const node = doc.createElement("Output");
      node.setAttribute("id", out.id);
      node.setAttribute("longName", out.longName);
      node.setAttribute("shortName", out.shortName);
      outputsNode.appendChild(node);
  });
  settingsNode.appendChild(outputsNode);

  // MultiViews
  if (caps.multiviews > 0) {
    const mvsNode = doc.createElement("MultiViews");
    const isNumericLayout = caps.mvLayoutType === "numeric";
    const winCount = isNumericLayout ? 16 : 10;

    for (let i = 0; i < caps.multiviews; i++) {
      const node = doc.createElement("MultiView");
      node.setAttribute("index", i.toString());
      if (isNumericLayout) {
        node.setAttribute("LayoutID", "13"); // Standard Quad/MultiView layout
        node.setAttribute("vuMeterOpacity", "1");
        node.setAttribute("borderColour", "0.59,0.59,0.59,1");
      } else {
        node.setAttribute("layout", "ProgramBottom");
        node.setAttribute("vuMeterOpacity", "1");
        node.setAttribute("programPreviewSwapped", "False");
      }
      
      const meIndex = Math.min(i, (caps.mes || 1) - 1);
      const prgId = (10010 + (meIndex * 10)).toString();
      const prvId = (10011 + (meIndex * 10)).toString();
      
      const windowsNode = doc.createElement("Windows");
      for(let w = 0; w < winCount; w++) {
          const win = doc.createElement("Window");
          win.setAttribute("index", w.toString());
          if (w === 0) {
              win.setAttribute("input", prvId); // Window 0 is usually Preview
          } else if (w === 1) {
              win.setAttribute("input", prgId); // Window 1 is usually Program
          } else {
              const camId = (w - 1).toString();
              win.setAttribute("input", parseInt(camId) <= caps.inputs ? camId : "0");
          }
          windowsNode.appendChild(win);
      }
      node.appendChild(windowsNode);
      mvsNode.appendChild(node);
    }
    
    settingsNode.appendChild(mvsNode);
  }

  // Audio mapping
  if (caps.audioEngine === "fairlight") {
      const flNode = doc.createElement("FairlightAudioMixer");
      if (caps.hasAudioMapping) {
          const mapNode = doc.createElement("AudioMapping");
          const mapOuts = doc.createElement("AudioOutputs");
          
          if (caps.audioRoutingOutputs && caps.audioRoutingOutputs.length > 0) {
              caps.audioRoutingOutputs.forEach(outInfo => {
                  outInfo.channelPairs.forEach(pairIdx => {
                      const chNode = doc.createElement("Output");
                      const baseId = outInfo.outputId * 65536 + pairIdx; 
                      chNode.setAttribute("id", baseId.toString());
                      chNode.setAttribute("sourceId", pairIdx === 0 ? "150798336" : "0"); 
                      
                      const leftCh = (pairIdx * 2) + 1;
                      const rightCh = (pairIdx * 2) + 2;
                      chNode.setAttribute("name", `${outInfo.outputName} ${leftCh}/${rightCh}`);
                      mapOuts.appendChild(chNode);
                  });
              });
          }
          mapNode.appendChild(mapOuts);

          const mapSrcs = doc.createElement("AudioSources");
          if (caps.audioRoutingSources && caps.audioRoutingSources.length > 0) {
              caps.audioRoutingSources.forEach(srcInfo => {
                  if (srcInfo.inputId === 0) {
                      const srcNode = doc.createElement("Source");
                      srcNode.setAttribute("id", "0");
                      srcNode.setAttribute("name", srcInfo.sourceName);
                      mapSrcs.appendChild(srcNode);
                  } else {
                      // Generate 16 channels (8 pairs) for ALL sources
                      const pairs = srcInfo && srcInfo.channelPairs && srcInfo.channelPairs.length > 0 ? srcInfo.channelPairs : [0];
                for (let pairIdx of pairs) {
                          const srcNode = doc.createElement("Source");
                          const baseId = srcInfo.inputId * 65536 + pairIdx;
                          srcNode.setAttribute("id", baseId.toString());
                          const leftCh = (pairIdx * 2) + 1;
                          const rightCh = (pairIdx * 2) + 2;
                          let name = srcInfo.sourceName.replace(/\s\d+\/\d+$/, "");
                          srcNode.setAttribute("name", `${name} ${leftCh}/${rightCh}`);
                          mapSrcs.appendChild(srcNode);
                      }
                  }
              });
          }
          mapNode.appendChild(mapSrcs);

          root.appendChild(mapNode);
      }
      
      // Default Audio Inputs
      const audioInputsNode = doc.createElement("AudioInputs");
      const mpCount = (caps.mes || 1) >= 2 ? 4 : 2;
      const audioSourceIds = Array.from({length: caps.inputs}, (_, i) => (i + 1).toString());
      for (let i = 1; i <= mpCount; i++) {
          audioSourceIds.push((3000 + (i * 10)).toString());
      }
      audioSourceIds.forEach(id => {
          const inp = doc.createElement("AudioInput");
          inp.setAttribute("id", id);
          inp.setAttribute("configuration", "Stereo");
          const srcNode = doc.createElement("AudioSource");
          srcNode.setAttribute("id", "-65280");
          srcNode.setAttribute("mixOption", "Off");
          inp.appendChild(srcNode);
          audioInputsNode.appendChild(inp);
      });
      flNode.appendChild(audioInputsNode);
      
      root.appendChild(flNode);
  } else {
      const audioNode = doc.createElement("AudioMixer");
      
      // Default Audio Inputs
      const audioInputsNode = doc.createElement("AudioInputs");
      const mpCount = (caps.mes || 1) >= 2 ? 4 : 2;
      const audioSourceIds = Array.from({length: caps.inputs}, (_, i) => (i + 1).toString());
      for (let i = 1; i <= mpCount; i++) {
          audioSourceIds.push((3000 + (i * 10)).toString());
      }
      audioSourceIds.forEach(id => {
          const inp = doc.createElement("AudioInput");
          inp.setAttribute("id", id);
          inp.setAttribute("mixOption", "Off");
          audioInputsNode.appendChild(inp);
      });
      audioNode.appendChild(audioInputsNode);
      
      root.appendChild(audioNode);
  }

  // SuperSources (top-level Profile child on switchers with SuperSource DVEs)
  if (caps.hasSuperSource) {
      const ssrcNode = doc.createElement("SuperSources");
      const count = caps.ssrcCount || 1;
      for (let s = 0; s < count; s++) {
          const ssrc = doc.createElement("SuperSource");
          ssrc.setAttribute("index", s.toString());
          ssrc.setAttribute("artFillInput", "3010");
          ssrc.setAttribute("artKeyInput", "3011");
          ssrc.setAttribute("artOption", "Background");
          ssrc.setAttribute("artPreMultiplied", "False");
          ssrc.setAttribute("artClip", "50");
          ssrc.setAttribute("artGain", "70");
          ssrc.setAttribute("artInvertKey", "False");

          const boxes = doc.createElement("Boxes");
          for (let b = 0; b < 4; b++) {
              const box = doc.createElement("Box");
              box.setAttribute("index", b.toString());
              box.setAttribute("enabled", b === 0 ? "True" : "False");
              box.setAttribute("inputSource", "0");
              box.setAttribute("xPosition", (b % 2 === 0 ? "-8" : "8"));
              box.setAttribute("yPosition", (b < 2 ? "4.5" : "-4.5"));
              box.setAttribute("size", "0.5");
              box.setAttribute("cropped", "False");
              box.setAttribute("cropTop", "0");
              box.setAttribute("cropBottom", "0");
              box.setAttribute("cropLeft", "0");
              box.setAttribute("cropRight", "0");
              boxes.appendChild(box);
          }
          ssrc.appendChild(boxes);
          ssrcNode.appendChild(ssrc);
      }
      root.appendChild(ssrcNode);
  }

  // Counters (Display clock / countdown timers on supported switchers)
  if (caps.hasCounters) {
      const countersNode = doc.createElement("Counters");
      const counter = doc.createElement("Counter");
      counter.setAttribute("index", "0");
      counter.setAttribute("enabled", "False");
      counter.setAttribute("mode", "Countdown");
      counter.setAttribute("autoHide", "False");
      counter.setAttribute("positionX", "0");
      counter.setAttribute("positionY", "-6.3");
      counter.setAttribute("size", "25");
      counter.setAttribute("opacity", "100");
      counter.setAttribute("startFromHours", "0");
      counter.setAttribute("startFromMinutes", "0");
      counter.setAttribute("startFromSeconds", "0");
      counter.setAttribute("startFromFrames", "0");
      countersNode.appendChild(counter);
      root.appendChild(countersNode);
  }

  // LiveStream & Record Profile Output block
  if (caps.hasStreamRecord) {
      const outputNode = doc.createElement("Output");
      const streamNode = doc.createElement("LiveStream");
      streamNode.setAttribute("serviceName", "YouTube RTMP");
      streamNode.setAttribute("url", "rtmps://a.rtmps.youtube.com/live2");
      streamNode.setAttribute("key", "");
      streamNode.setAttribute("streamIdExtensions", "");
      streamNode.setAttribute("lowLatency", "False");
      streamNode.setAttribute("streamDownConvertMode", "None");

      const creds = doc.createElement("Credentials");
      creds.setAttribute("username", "");
      creds.setAttribute("password", "");
      streamNode.appendChild(creds);

      const bitrate = doc.createElement("bitrate");
      bitrate.setAttribute("low", "45000000");
      bitrate.setAttribute("high", "70000000");
      streamNode.appendChild(bitrate);

      const audioBitrate = doc.createElement("audioBitrate");
      audioBitrate.setAttribute("low", "128000");
      audioBitrate.setAttribute("high", "128000");
      streamNode.appendChild(audioBitrate);

      outputNode.appendChild(streamNode);

      const recordNode = doc.createElement("Record");
      const safePrefix = pName.replace(/[^a-zA-Z0-9]/g, "_");
      recordNode.setAttribute("filename", safePrefix);
      recordNode.setAttribute("recordInAllCameras", "False");
      recordNode.setAttribute("recordAllISOInputs", caps.hasIso ? "True" : "False");
      outputNode.appendChild(recordNode);

      root.appendChild(outputNode);
  }
  
  // Custom Fallback Prompting for Inputs/Aux
  if (caps.isCustom) {
      const customInputs = prompt("Enter number of External Inputs:", "8");
      if (customInputs) {
          let inputsNode = settingsNode.querySelector("Inputs");
          if (!inputsNode) {
              inputsNode = doc.createElement("Inputs");
              settingsNode.appendChild(inputsNode);
          }
          inputsNode.innerHTML = '';
          for (let i = 1; i <= parseInt(customInputs); i++) {
              const node = doc.createElement("Input");
              node.setAttribute("id", i.toString());
              node.setAttribute("longName", `Camera ${i}`);
              node.setAttribute("shortName", `Cam${i}`);
              inputsNode.appendChild(node);
          }
      }
      
      const customAux = prompt("Enter number of Aux Outputs:", "2");
      if (customAux) {
          let auxNode = root.querySelector("Auxiliaries");
          if (!auxNode) {
              auxNode = doc.createElement("Auxiliaries");
              root.appendChild(auxNode);
          }
          auxNode.innerHTML = '';
          for (let i = 0; i < parseInt(customAux); i++) {
              const node = doc.createElement("Auxiliary");
              node.setAttribute("id", (8001 + i).toString());
              node.setAttribute("input", "10010");
              auxNode.appendChild(node);
          }
      }
  }
  
  const serializer = new XMLSerializer();
  const xmlString = serializer.serializeToString(doc);
  parseATEMXML(xmlString);
}

initCreateFromScratch();

// --- PARSER ---
function parseATEMXML(xmlString) {
  const parser = new DOMParser();
  appState.xmlDoc = parser.parseFromString(xmlString, "text/xml");
  appState.originalXmlString = xmlString; // Store pristine copy for resetting

  analyzeATEMProfile(appState.xmlDoc);
  cacheInputNames();
  cacheAudioMixOptions();
  updateDashboardUI();
  if (typeof showToast === "function") {
    showToast(`Loaded: ${appState.productName}`);
  }
}

/**
 * Analyzes the uploaded/active XML document to determine hardware generation,
 * audio engine (Fairlight vs legacy), SuperSource engines, and Multiview layout formats.
 * Cross-references with the official Companion database for maximum accuracy.
 * @param {Document} xmlDoc - Active XML DOM Document
 */
function analyzeATEMProfile(xmlDoc) {
  const profileNode = xmlDoc.querySelector("Profile");
  appState.productName = profileNode
    ? (profileNode.getAttribute("product") || "Unknown ATEM")
    : "Unknown ATEM";

  // Resolve authoritative hardware capabilities from Companion/BMD database
  const caps = typeof findModelCapabilities === 'function'
    ? findModelCapabilities(appState.productName)
    : (typeof MODEL_CAPABILITIES !== 'undefined' ? MODEL_CAPABILITIES[appState.productName] : null);

  const productUpper = appState.productName.toUpperCase();

  // Audio mapping support (MADI / Fairlight routing table)
  appState.hasAudioMapping =
    xmlDoc.querySelector("AudioMapping > AudioOutputs > Output") !== null ||
    xmlDoc.querySelector("AudioMapping AudioOutputs Output, AudioMapping > Output") !== null ||
    (caps ? caps.hasAudioMapping : false);

  // Determine whether Fairlight engine or legacy AudioMixer is in use
  appState.audioEngine = (xmlDoc.querySelector("FairlightAudioMixer") || 
                          appState.hasAudioMapping || 
                          (caps && caps.audioEngine === "fairlight") || 
                          productUpper.includes("CONSTELLATION") || 
                          productUpper.includes("EXTREME"))
    ? "fairlight"
    : "legacy";
  appState.hasFairlight = appState.audioEngine === "fairlight";

  // SuperSource engines
  appState.superSourceCount = xmlDoc.querySelectorAll("SuperSources > SuperSource").length;
  if (appState.superSourceCount === 0 && caps && caps.hasSuperSource) {
    appState.superSourceCount = caps.ssrcCount || 1;
  }
  appState.hasSuperSource = appState.superSourceCount > 0;

  // MADI presence (Constellation 8K / 4M/E high-density audio)
  appState.hasMadi =
    xmlDoc.querySelector("AudioMapping AudioOutputs Output[name^='MADI'], AudioMapping Output[name^='MADI']") !== null ||
    productUpper.includes("8K") ||
    productUpper.includes("4 M/E");

  // Network ingest (SRT / RTMP streaming inputs on HD8 series)
  appState.hasNetworkIngest =
    xmlDoc.querySelector("StreamingInputs") !== null ||
    productUpper.includes("HD8");

  // ISO Recording detection
  appState.hasIso =
    productUpper.includes("ISO") ||
    productUpper.includes("ATEM SDI EXTREME") ||
    productUpper.includes("ATEM SDI PRO") ||
    (caps ? caps.hasIso : false) ||
    xmlDoc.querySelector("RecordAllInputs") !== null ||
    xmlDoc.querySelector("Record[recordAllISOInputs]") !== null;

  // Streaming / USB webcam recording features
  appState.hasStreamRecord =
    xmlDoc.querySelector("LiveStream") !== null ||
    xmlDoc.querySelector("Record") !== null ||
    appState.hasIso ||
    (caps ? caps.hasStreamRecord : false) ||
    productUpper.includes("MINI PRO") ||
    productUpper.includes("EXTREME") ||
    productUpper.includes("HD8");
  
  // Counters (display clock / timers)
  appState.hasCounters = xmlDoc.querySelector("Counters") !== null || (caps ? caps.hasCounters : false);

  // Multiview layout engine (numeric LayoutID bitmask on modern vs text layout name on legacy)
  const sampleMV = xmlDoc.querySelector("MultiView");
  if (sampleMV) {
    appState.mvLayoutType = sampleMV.hasAttribute("LayoutID") ? "numeric" : "text";
    appState.generation = sampleMV.hasAttribute("LayoutID") ? "modern" : "legacy";
  } else if (caps) {
    appState.mvLayoutType = caps.mvLayoutType || "text";
    appState.generation = caps.mvLayoutType === "numeric" ? "modern" : "legacy";
  } else {
    appState.mvLayoutType = "text";
    appState.generation = "legacy";
  }

  const mvs = xmlDoc.querySelectorAll("MultiViews > MultiView");
  appState.multiviewCount = mvs.length > 0 ? mvs.length : (caps ? caps.multiviews : 1);

  // Switcher classification tier
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

/**
 * Caches short and long input names from XML to prevent repeated DOM queries.
 */
function cacheInputNames() {
  appState.inputsMap.clear();

  // 1. Cache standard video inputs (Cameras, Media Players, Thunderbolt)
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

  // Fallbacks just in case standard IDs are absent from a stripped XML
  if (!appState.inputsMap.has("10010")) appState.inputsMap.set("10010", "Program");
  if (!appState.inputsMap.has("10011")) appState.inputsMap.set("10011", "Preview");
  if (appState.hasStreamRecord) {
    if (!appState.inputsMap.has("9101")) appState.inputsMap.set("9101", "Record Status");
    if (!appState.inputsMap.has("9102")) appState.inputsMap.set("9102", "Stream Status");
    if (!appState.inputsMap.has("9103")) appState.inputsMap.set("9103", "Audio Status");
  }
}

/**
 * Caches active audio mixOption ('On', 'AudioFollowVideo', 'Off') for every input.
 * Accurately inspects Fairlight audio sources (stereo -65280, mono -256) or legacy mixer inputs.
 */
function cacheAudioMixOptions() {
  appState.mixOptionsMap.clear();
  
  if (appState.hasFairlight) {
    appState.xmlDoc.querySelectorAll("FairlightAudioMixer AudioInputs AudioInput").forEach(inp => {
      // Priority: standard stereo pair (-65280), split mono channel (-256), or first audio source
      const src = inp.querySelector('AudioSource[id="-65280"]') || 
                  inp.querySelector('AudioSource[id="-256"]') || 
                  inp.querySelector("AudioSource");
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

  document.getElementById("badge-ssrc").className = `badge ${appState.hasSuperSource}`;
  document.getElementById("badge-fairlight").className = `badge ${appState.hasFairlight}`;
  document.getElementById("badge-madi").className = `badge ${appState.hasMadi}`;
  document.getElementById("badge-iso").className = `badge ${appState.hasIso}`;
  document.getElementById("badge-net").className = `badge ${appState.hasNetworkIngest}`;
  document.getElementById("badge-counters").className = `badge ${appState.hasCounters}`;
  
  document.getElementById("system-info").style.display = "inline-block";
  // Enable all nav buttons, then conditionally disable them if the XML lacks the config
  document
    .querySelectorAll(".nav-btn")
    .forEach((btn) => {
      // Don't enable the overview tab, it's always enabled
      if(btn.id) btn.disabled = false;
    });

  const mvNav = document.getElementById("nav-multiview");
  if (mvNav && appState.xmlDoc.querySelectorAll("MultiViews > MultiView").length === 0) {
    mvNav.disabled = true;
    mvNav.title = "No multiview configuration found in this XML";
  }

  const auxNav = document.getElementById("nav-aux");
  if (auxNav && appState.xmlDoc.querySelectorAll("Auxiliaries > Auxiliary").length === 0) {
    auxNav.disabled = true;
    auxNav.title = "No auxiliary outputs found in this XML";
  }

  const labelsNav = document.getElementById("nav-labels");
  if (labelsNav && appState.xmlDoc.querySelectorAll("Inputs > Input").length === 0) {
    labelsNav.disabled = true;
    labelsNav.title = "No input routing or labels found in this XML";
  }

  const audioNav = document.getElementById("nav-audio");
  if (audioNav && (!appState.hasFairlight || !appState.hasAudioMapping)) {
    audioNav.disabled = true;
    audioNav.title = "Audio output routing is not available or missing in this XML";
  }

  const streamRecordNav = document.getElementById("nav-stream-record");
  if (streamRecordNav) {
    if (!appState.hasStreamRecord) {
      streamRecordNav.disabled = true;
      streamRecordNav.title = "Live Stream & Record settings are not available for this model";
    } else {
      streamRecordNav.disabled = false;
      streamRecordNav.title = "";
    }
  }

  const countersNav = document.getElementById("nav-counters");
  if (countersNav) {
    if (!appState.hasCounters) {
      countersNav.disabled = true;
      countersNav.title = "Counters are not available on this model";
    } else {
      countersNav.disabled = false;
      countersNav.title = "";
    }
  }

  buildLabelsTable();
  buildAuxMatrix();
  buildMultiview();
  buildAudioMapping();
  buildStreamRecordPanel();
  buildCountersPanel();

  // Keep ingestion UI accessible so user can load another XML or create from scratch without reloading
  const dropZone = document.getElementById("drop-zone");
  if (dropZone) {
    dropZone.style.display = "block";
    dropZone.classList.add("drop-zone-active");
    const h2 = dropZone.querySelector("h2");
    if (h2) h2.innerText = "Load a Different ATEM XML";
    const p = dropZone.querySelector("p");
    if (p) p.innerText = "Drop another .xml file here or click to switch configuration";
  }
  
  const createZone = document.querySelector(".create-scratch-zone");
  if (createZone) createZone.style.display = "block";
  
  const usageCard = document.querySelector(".card-usage");
  if (usageCard) usageCard.style.display = "block";

  // Ensure system-info is visible
  document.getElementById("system-info").style.display = "block";

  // Display top header Reset button
  const resetBtn = document.getElementById("btn-reset-session");
  if (resetBtn) resetBtn.style.display = "inline-flex";
  
  // Force activate overview tab
  const overviewBtn = document.querySelector('[data-target="tab-overview"]');
  if (overviewBtn) {
      overviewBtn.click();
  }
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

    const pName = (appState.productName || "").toLowerCase();
    const isCompact = pName.includes("mini") || pName.includes("extreme") || pName.includes("sdi");

    // Hide 9xxx sources, EXCEPT Multiviews on compact models (which can route MV to Aux and rename it)
    if (parseInt(id) >= 9000 && parseInt(id) < 10000) {
      const isMv = parseInt(id) >= 9001 && parseInt(id) <= 9099;
      if (!isMv || !isCompact) {
        return;
      }
    }
    
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
  return appState.mixOptionsMap.get(inputId) || "Off";
}

// Set the mixOption for a given input ID and update button styles
function updateAudioMixOption(inputId, newValue, clickedBtn) {
  // Fairlight path
  if (appState.audioEngine === "fairlight") {
      let flNode = appState.xmlDoc.querySelector("FairlightAudioMixer");
      if (!flNode) {
          flNode = appState.xmlDoc.createElement("FairlightAudioMixer");
          appState.xmlDoc.documentElement.appendChild(flNode);
      }
      let inputsNode = flNode.querySelector("AudioInputs");
      if (!inputsNode) {
          inputsNode = appState.xmlDoc.createElement("AudioInputs");
          flNode.appendChild(inputsNode);
      }
      let inpNode = inputsNode.querySelector(`AudioInput[id="${inputId}"]`);
      if (!inpNode) {
          inpNode = appState.xmlDoc.createElement("AudioInput");
          inpNode.setAttribute("id", inputId);
          inpNode.setAttribute("configuration", "Stereo");
          inputsNode.appendChild(inpNode);
      }
      const srcNodes = inpNode.querySelectorAll("AudioSource");
      if (srcNodes.length === 0) {
          const isMono = inpNode.getAttribute("configuration") === "Mono";
          const srcNode = appState.xmlDoc.createElement("AudioSource");
          // Blackmagic uses -65280 (0xFF00) for stereo pairs, -256 for mono
          srcNode.setAttribute("id", isMono ? "-256" : "-65280");
          srcNode.setAttribute("mixOption", newValue);
          inpNode.appendChild(srcNode);
      } else {
          srcNodes.forEach(src => src.setAttribute("mixOption", newValue));
      }
  } else {
      // Legacy path (<AudioMixer>)
      let mixNode = appState.xmlDoc.querySelector("AudioMixer");
      if (!mixNode) {
          mixNode = appState.xmlDoc.createElement("AudioMixer");
          appState.xmlDoc.documentElement.appendChild(mixNode);
      }
      let inputsNode = mixNode.querySelector("AudioInputs");
      if (!inputsNode) {
          inputsNode = appState.xmlDoc.createElement("AudioInputs");
          mixNode.appendChild(inputsNode);
      }
      let inpNode = inputsNode.querySelector(`AudioInput[id="${inputId}"]`);
      if (!inpNode) {
          inpNode = appState.xmlDoc.createElement("AudioInput");
          inpNode.setAttribute("id", inputId);
          inputsNode.appendChild(inpNode);
      }
      inpNode.setAttribute("mixOption", newValue);
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
    cacheInputNames(); // Refresh map for all names
    
    // Re-render dependent UI sections to reflect new names
    buildAuxMatrix();
    buildMultiview();
    buildAudioMapping();
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

  const caps = typeof findModelCapabilities === 'function'
    ? findModelCapabilities(appState.productName)
    : (typeof MODEL_CAPABILITIES !== 'undefined' && MODEL_CAPABILITIES[appState.productName] 
        ? MODEL_CAPABILITIES[appState.productName] 
        : { inputs: 8, multiviews: 1, hasSuperSource: false });
  const externalInputCount = caps.inputs || 8;
  
  // External Inputs (1 to N)
  const externalIds = [];
  for (let i = 1; i <= externalInputCount; i++) {
      externalIds.push(i.toString());
  }

  // Internal Sources
  const internalIds = [];
  internalIds.push({ id: "0", label: "Black" });
  internalIds.push({ id: "1000", label: "Color Bars" });
  internalIds.push({ id: "2001", label: "Color 1" });
  internalIds.push({ id: "2002", label: "Color 2" });
  
  const mpCount = (caps.mes && caps.mes >= 2) || (externalInputCount > 20) ? 4 : 2;
  for (let i = 1; i <= mpCount; i++) {
      internalIds.push({ id: "30" + i + "0", label: "Media Player " + i });
      internalIds.push({ id: "30" + i + "1", label: "Media Player " + i + " Key" });
  }
  
  if (caps.hasSuperSource) {
      internalIds.push({ id: "6000", label: "SuperSource 1" });
      if (caps.ssrcCount >= 2 || externalInputCount >= 40) {
          internalIds.push({ id: "6001", label: "SuperSource 2" });
      }
  }
  
  const meCount = caps.mes || ((externalInputCount >= 40) ? 4 : (externalInputCount >= 20 ? 2 : 1));
  const uskCount = caps.usks || (meCount >= 4 ? 4 : (meCount >= 2 ? 2 : 1));
  
  for (let i = 1; i <= meCount; i++) {
      internalIds.push({ id: (7000 + i).toString(), label: `Clean Feed ${i}` });
  }
  
  for (let i = 1; i <= meCount; i++) {
      internalIds.push({ id: "100" + i + "0", label: "ME " + i + " Program" });
      internalIds.push({ id: "100" + i + "1", label: "ME " + i + " Preview" });
  }
  
  for (let i = 1; i <= meCount; i++) {
      for (let k = 1; k <= uskCount; k++) {
          const maskId = 4000 + ((i - 1) * 40) + (k * 10); 
          internalIds.push({ id: maskId.toString(), label: `ME ${i} Key ${k} Mask` });
      }
  }
  
  const dskCount = caps.dsks || ((externalInputCount >= 40) ? 4 : 2);
  for (let i = 1; i <= dskCount; i++) {
      internalIds.push({ id: (5000 + (i * 10)).toString(), label: `DSK ${i} Mask` });
  }
  
  const pName = (appState.productName || "").toLowerCase();
  if (pName.includes("mini") || pName.includes("extreme") || pName.includes("sdi")) {
      const mvCount = caps.multiviews || 1;
      for (let i = 1; i <= mvCount; i++) {
          internalIds.push({ id: "900" + i, label: "Multiview " + i });
      }
  }

  // --- INPUTS MATRIX ---
  let inHeaderHTML = "<thead><tr><th>Outputs \\ Inputs</th>";
  externalIds.forEach((id) => {
    inHeaderHTML += '<th>' + escapeHTML(appState.inputsMap.get(id) || "Input " + id) + '</th>';
  });
  inHeaderHTML += "</tr></thead><tbody>";

  // --- OUTPUTS (INTERNAL) MATRIX ---
  let outHeaderHTML = "<thead><tr><th>Outputs \\ Internal Sources</th>";
  internalIds.forEach((src) => {
    const customName = appState.inputsMap.get(src.id);
    outHeaderHTML += '<th>' + escapeHTML(customName || src.label) + '</th>';
  });
  outHeaderHTML += "</tr></thead><tbody>";

  // --- POPULATE ROWS ---
  let inBodyHTML = "";
  let outBodyHTML = "";

  auxes.forEach((aux, i) => {
    const auxId = aux.getAttribute("id");
    const currentInput = aux.getAttribute("input");
    const parsedAuxId = parseInt(auxId, 10);
    const pName = (appState.productName || "").toLowerCase();
    const isMiniSDI = pName.includes("mini") || pName.includes("sdi");
    let fallbackAuxName;
    if (parsedAuxId === 8200 && isMiniSDI) {
      fallbackAuxName = pName.includes("g2") ? "Thunderbolt 1" : "USB Webcam Out";
    } else if (parsedAuxId >= 8001 && parsedAuxId <= 8099 && isMiniSDI) {
      fallbackAuxName = (pName.includes("sdi") ? "SDI Out " : "HDMI Out ") + (parsedAuxId - 8000);
    } else if (parsedAuxId >= 8001 && parsedAuxId <= 8099) {
      fallbackAuxName = "Aux " + (parsedAuxId - 8000);
    } else {
      fallbackAuxName = "Aux " + auxId;
    }
    const auxName = appState.inputsMap.get(auxId) || fallbackAuxName;

    // Inputs row
    let inRow = '<tr><td>' + escapeHTML(auxName) + '</td>';
    externalIds.forEach((inId) => {
      const isChecked = currentInput === inId ? "checked" : "";
      const uniqueId = 'aux_in_' + auxId + '_' + inId;
      inRow += '<td><input type="radio" class="cp-radio" name="auxgrp_' + auxId + '" id="' + uniqueId + '" ' + isChecked + ' onchange="updateAux(\'' + auxId + '\', \'' + inId + '\', ' + i + ')"><label class="cp-label" for="' + uniqueId + '" title="Route ' + escapeHTML(appState.inputsMap.get(inId) || "Input "+inId) + ' to ' + escapeHTML(auxName) + '"></label></td>';
    });
    inRow += '</tr>';
    inBodyHTML += inRow;

    // Internal Sources row
    let outRow = '<tr><td>' + escapeHTML(auxName) + '</td>';
    internalIds.forEach((src) => {
      const outId = src.id;
      const isChecked = currentInput === outId ? "checked" : "";
      const uniqueId = 'aux_out_' + auxId + '_' + outId;
      outRow += '<td><input type="radio" class="cp-radio" name="auxgrp_' + auxId + '" id="' + uniqueId + '" ' + isChecked + ' onchange="updateAux(\'' + auxId + '\', \'' + outId + '\', ' + i + ')"><label class="cp-label" for="' + uniqueId + '" title="Route ' + escapeHTML(appState.inputsMap.get(outId) || src.label) + ' to ' + escapeHTML(auxName) + '"></label></td>';
    });
    outRow += '</tr>';
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

  // Group outputs by prefix (e.g. "Aux", "MADI", "Program", "Headphones")
  const groups = new Map();
  audioOutputNodes.forEach((node) => {
    const name = node.getAttribute("name") || "";
    const match = name.match(/^([a-zA-Z]+)/);
    const groupKey = match ? match[1] : name;

    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(node);
  });

  let tabIdx = 0;
  groups.forEach((outputs, groupName) => {
    const currentIdx = tabIdx++;

    // Tab button
    const btn = document.createElement("button");
    btn.className = "audio-output-tab" + (currentIdx === 0 ? " active" : "");
    btn.textContent = groupName;
    btn.setAttribute("data-audio-idx", currentIdx);
    btn.addEventListener("click", () => switchAudioOutputTab(currentIdx));
    tabBar.appendChild(btn);

    // Panel
    const panel = document.createElement("div");
    panel.className =
      "audio-output-panel" + (currentIdx === 0 ? " active" : "");
    panel.id = "audio-panel-" + currentIdx;

    const section = document.createElement("div");
    section.className = "audio-map-section";

    // Group \outputs\ by the specific output name (e.g. "Aux 1", "MADI 16")
    const subGroups = new Map();
    outputs.forEach((chNode) => {
        const outName = chNode.getAttribute("name") || "";
        const match = outName.match(/^(.+?)\s+\d+\/\d+$/);
        const subGroupKey = match ? match[1] : outName;
        if (!subGroups.has(subGroupKey)) subGroups.set(subGroupKey, []);
        subGroups.get(subGroupKey).push(chNode);
    });
    
    const headerControls = document.createElement("div");
    headerControls.className = "audio-subgroup-header";
    headerControls.style.display = "flex";
    headerControls.style.justifyContent = "space-between";
    headerControls.style.alignItems = "center";
    headerControls.style.marginBottom = "15px";

    const title = document.createElement("h3");
    title.textContent = groupName;
    title.style.margin = "0";

    const selector = document.createElement("select");
    selector.className = "subgroup-selector";
    selector.style.padding = "6px 12px";
    selector.style.borderRadius = "4px";
    selector.style.background = "var(--bg-dark)";
    selector.style.color = "var(--text-main)";
    selector.style.border = "1px solid var(--border)";
    
    const gridContainer = document.createElement("div");
    
    // Populate selector options
    subGroups.forEach((subOutputs, subGroupKey) => {
        let dispName = subGroupKey;
        const auxMatch = subGroupKey.match(/^Aux\s*(\d+)/i);
        if (auxMatch) {
            const auxId = 8000 + parseInt(auxMatch[1], 10);
            const actualName = appState.inputsMap.get(auxId.toString());
            if (actualName) dispName = actualName;
        }
        const option = document.createElement("option");
        option.value = subGroupKey;
        option.textContent = dispName;
        selector.appendChild(option);
    });
    
    headerControls.appendChild(title);
    if (subGroups.size > 1) {
        headerControls.appendChild(selector);
    }
    section.appendChild(headerControls);
    section.appendChild(gridContainer);
    
    const renderSubGroup = (key) => {
        gridContainer.innerHTML = "";
        const grid = document.createElement("div");
        grid.className = "audio-channel-grid";
        
        subGroups.get(key).forEach((chNode) => {
            const outName = chNode.getAttribute("name");
            const currentSourceId = chNode.getAttribute("sourceId") || "0";
            
            const pairMatch = outName.match(/\s+(\d+\/\d+)$/);
            const rowLabel = pairMatch ? pairMatch[1] : outName;
            
            const row = document.createElement("div");
            row.className = "audio-channel-row";
            
            const label = document.createElement("label");
            label.textContent = "Ch " + rowLabel;
            label.title = outName;
            row.appendChild(label);
            
            const select = document.createElement("select");
            select.onchange = (e) => {
                chNode.setAttribute("sourceId", e.target.value);
            };
            
            let optionsHTML = "";
            audioSources.forEach((src) => {
                const selected = src.id === currentSourceId ? "selected" : "";
                optionsHTML += '<option value="' + src.id + '" ' + selected + '>' + escapeHTML(src.label) + '</option>';
            });
            select.innerHTML = optionsHTML;
            row.appendChild(select);
            grid.appendChild(row);
        });
        gridContainer.appendChild(grid);
    };
    
    if (subGroups.size > 0) {
        const firstKey = subGroups.keys().next().value;
        renderSubGroup(firstKey);
        selector.addEventListener("change", (e) => {
            renderSubGroup(e.target.value);
        });
    }

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
      
      if (id) {
          const physicalId = Math.floor(parseInt(id, 10) / 65536).toString();
          
          // Only override the label from inputsMap for actual physical video inputs (<1000)
          // or aux outputs (8000-8999), and Media Players (3000-3099). 
          // Do NOT override 10000+ (M/E Program, Preview, etc) because Blackmagic natively 
          // calls them "Program" instead of "ME 1" in audio contexts.
          const physInt = parseInt(physicalId);
          if (physInt < 1000 || (physInt >= 3000 && physInt <= 3999) || (physInt >= 8000 && physInt <= 8999)) {
            const actualName = appState.inputsMap.get(physicalId);
            if (actualName) {
                // If there's a channel pair suffix (e.g. " 1/2"), preserve it
                const pairMatch = name.match(/\s+\d+\/\d+$/);
                if (pairMatch) {
                    name = `${actualName}${pairMatch[0]}`;
                } else {
                    name = actualName;
                }
            }
          }

          if (!seen.has(id)) {
              seen.add(id);
              sources.push({ id, label: name });
          }
      }
    });

  // If we got sources from AudioSources, return early — they're the authoritative list
  if (sources.length > 0) return sources;

  // Fallback: use SDK audioRoutingSources (prevents non-audio sources like Color from appearing)
  const sdkCaps = typeof findModelCapabilities === 'function'
    ? findModelCapabilities(appState.productName)
    : (typeof MODEL_CAPABILITIES !== 'undefined' ? MODEL_CAPABILITIES[appState.productName] : null);
  if (sdkCaps && sdkCaps.audioRoutingSources && sdkCaps.audioRoutingSources.length > 0) {
    sdkCaps.audioRoutingSources.forEach(src => {
      const srcId = src.inputId.toString();
      if (!seen.has(srcId)) {
        seen.add(srcId);
        sources.push({ id: srcId, label: src.sourceName });
      }
    });
  }

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
      const layoutId = currentLayout !== null && currentLayout !== "" && !isNaN(currentLayout) ? parseInt(currentLayout) : 15;
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
      const layoutId = currentLayout !== null && currentLayout !== "" && !isNaN(currentLayout) ? parseInt(currentLayout) : 15;

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
  const attr = mvNode.getAttribute("LayoutID");
  let currentId = attr !== null && attr !== "" ? parseInt(attr) : 15;

  // Modify the bitmask based on the toggle
  if (isChecked) {
    currentId |= bitMask;
  } else {
    currentId &= ~bitMask;
    
    // When unsplitting, ensure the primary window doesn't have an invalid Status Overlay source
    let primaryWinIndex = 0;
    if (bitMask === 1) primaryWinIndex = 0;
    else if (bitMask === 2) primaryWinIndex = 2;
    else if (bitMask === 4) primaryWinIndex = 8;
    else if (bitMask === 8) primaryWinIndex = 10;
    
    const winNode = mvNode.querySelector(`Windows > Window[index="${primaryWinIndex}"]`);
    if (winNode) {
      const currentInput = winNode.getAttribute("input");
      if (["9101", "9102", "9103"].includes(currentInput)) {
        winNode.setAttribute("input", "0"); // Fallback to Black
      }
    }
  }

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

  // Ensure Black (0) is always available as a selectable source
  const blackOption = document.createElement("option");
  blackOption.value = "0";
  blackOption.text = "[0] Black";
  inGroup.appendChild(blackOption);

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
  
  for (const [id, label] of appState.inputsMap.entries()) {
    if (parseInt(id) < 1000) continue; // Skip physical inputs (already in Inputs group)
    
    // According to the SDK, Multiviews do not have SourceAvailability.Multiviewer.
    // They cannot be routed into a Multiview on ANY ATEM model.
    const isMvSource = parseInt(id) >= 9000 && parseInt(id) < 9100;
    if (isMvSource) continue;

    const option = document.createElement("option");
    option.value = id;
    option.text = `[${id}] ${label}`;
    outGroup.appendChild(option);
  }
  select.appendChild(outGroup);

  // Pre-select the current source and determine if it's a large window
  const mvNode = appState.xmlDoc.querySelectorAll("MultiViews > MultiView")[mvIdx];
  const winNode = mvNode.querySelector(`Windows > Window[index="${winIdx}"]`);

  let isLargeWindow = false;
  if (appState.generation === "modern") {
    const attr = mvNode.getAttribute("LayoutID");
    const layoutId = attr !== null && attr !== "" ? parseInt(attr) : 15;
    const quadMap = { 0:0, 1:0, 4:0, 5:0, 2:1, 3:1, 6:1, 7:1, 8:2, 9:2, 12:2, 13:2, 10:3, 11:3, 14:3, 15:3 };
    const primaryBoxes = [0, 2, 8, 10];
    const quadIndex = quadMap[winIdx];
    if (quadIndex !== undefined) {
      const bitVal = Math.pow(2, quadIndex);
      const isSplit = (layoutId & bitVal) !== 0;
      isLargeWindow = !isSplit && primaryBoxes.includes(winIdx);
    }
  } else {
    isLargeWindow = (winIdx === 0 || winIdx === 1);
  }

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
  if (!mvNode) {
    document.getElementById("mv-modal").close();
    return;
  }

  let winNode = mvNode.querySelector(
    `Windows > Window[index="${appState.activeWindowIndex}"]`,
  );

  if (!winNode) {
    let windowsNode = mvNode.querySelector("Windows");
    if (!windowsNode) {
      windowsNode = appState.xmlDoc.createElement("Windows");
      mvNode.appendChild(windowsNode);
    }
    winNode = appState.xmlDoc.createElement("Window");
    winNode.setAttribute("index", appState.activeWindowIndex.toString());
    windowsNode.appendChild(winNode);
  }

  winNode.setAttribute("input", newVal);
  buildMultiview(); // Re-render the grid
  switchMultiviewTab(appState.activeMvIndex); // Ensure we stay on the same Multiview tab

  document.getElementById("mv-modal").close();
}

// --- LIVE STREAM & RECORD PANEL ---
function buildStreamRecordPanel() {
  const container = document.getElementById("stream-record-container");
  if (!container) return;
  container.innerHTML = "";

  const liveStreamNode = appState.xmlDoc.querySelector("Profile > Output > LiveStream");
  const recordNode = appState.xmlDoc.querySelector("Profile > Output > Record");

  if (!appState.hasStreamRecord) {
    container.innerHTML = `<p style="color:var(--text-muted);">Live Stream and Record settings are not available for this model.</p>`;
    return;
  }

  const grid = document.createElement("div");
  grid.className = "stream-record-grid";

  // --- LIVE STREAM CARD ---
  const serviceName = liveStreamNode ? (liveStreamNode.getAttribute("serviceName") || "") : "";
  const url = liveStreamNode ? (liveStreamNode.getAttribute("url") || "") : "";
  const key = liveStreamNode ? (liveStreamNode.getAttribute("key") || "") : "";
  
  const bitrateNode = liveStreamNode ? liveStreamNode.querySelector("bitrate") : null;
  const bitrateLow = bitrateNode ? (bitrateNode.getAttribute("low") || "") : "";
  const bitrateHigh = bitrateNode ? (bitrateNode.getAttribute("high") || "") : "";

  const audioNode = liveStreamNode ? liveStreamNode.querySelector("audioBitrate") : null;
  const audioLow = audioNode ? (audioNode.getAttribute("low") || "") : "";
  const audioHigh = audioNode ? (audioNode.getAttribute("high") || "") : "";

  const streamCard = document.createElement("div");
  streamCard.className = "info-card";
  streamCard.innerHTML = `
    <h3>Live Stream Settings</h3>
    <div class="form-group">
      <label for="stream-service">Service Name</label>
      <input type="text" id="stream-service" value="${escapeHTML(serviceName)}" onchange="updateXMLStreamAttr('serviceName', this.value)">
    </div>
    <div class="form-group">
      <label for="stream-url">Server URL</label>
      <input type="text" id="stream-url" value="${escapeHTML(url)}" onchange="updateXMLStreamAttr('url', this.value)">
    </div>
    <div class="form-group">
      <label for="stream-key">Stream Key</label>
      <input type="text" id="stream-key" value="${escapeHTML(key)}" onchange="updateXMLStreamAttr('key', this.value)">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label for="stream-bitrate-low">Bitrate Low (bps)</label>
        <input type="number" id="stream-bitrate-low" value="${bitrateLow}" onchange="updateXMLStreamBitrate('bitrate', 'low', this.value)">
      </div>
      <div class="form-group">
        <label for="stream-bitrate-high">Bitrate High (bps)</label>
        <input type="number" id="stream-bitrate-high" value="${bitrateHigh}" onchange="updateXMLStreamBitrate('bitrate', 'high', this.value)">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label for="stream-audio-low">Audio Bitrate Low (bps)</label>
        <input type="number" id="stream-audio-low" value="${audioLow}" onchange="updateXMLStreamBitrate('audioBitrate', 'low', this.value)">
      </div>
      <div class="form-group">
        <label for="stream-audio-high">Audio Bitrate High (bps)</label>
        <input type="number" id="stream-audio-high" value="${audioHigh}" onchange="updateXMLStreamBitrate('audioBitrate', 'high', this.value)">
      </div>
    </div>
  `;
  grid.appendChild(streamCard);

  // --- RECORD CARD ---
  const filename = recordNode ? (recordNode.getAttribute("filename") || "") : "";
  const recordInAllCameras = recordNode ? (recordNode.getAttribute("recordInAllCameras") === "True") : false;
  const recordAllISOInputs = recordNode ? (recordNode.getAttribute("recordAllISOInputs") === "True") : false;

  const recordCard = document.createElement("div");
  recordCard.className = "info-card";
  recordCard.innerHTML = `
    <h3>Record Settings</h3>
    <div class="form-group">
      <label for="record-filename">Filename Prefix</label>
      <input type="text" id="record-filename" value="${escapeHTML(filename)}" onchange="updateXMLRecordAttr('filename', this.value)">
    </div>
    <div class="form-group checkbox-group">
      <input type="checkbox" id="record-all-cameras" ${recordInAllCameras ? "checked" : ""} onchange="updateXMLRecordAttr('recordInAllCameras', this.checked)">
      <label for="record-all-cameras">Record in All Cameras</label>
    </div>
    <div class="form-group checkbox-group" style="display: ${appState.hasIso ? 'flex' : 'none'};">
      <input type="checkbox" id="record-all-iso" ${recordAllISOInputs ? "checked" : ""} onchange="updateXMLRecordAttr('recordAllISOInputs', this.checked)">
      <label for="record-all-iso">Record All ISO Inputs (ISO models)</label>
    </div>
  `;
  grid.appendChild(recordCard);

  container.appendChild(grid);
}

function getOrCreateOutputNode() {
  let profile = appState.xmlDoc.querySelector("Profile");
  if (!profile) return null;
  let outputNode = appState.xmlDoc.querySelector("Profile > Output");
  if (!outputNode) {
    outputNode = appState.xmlDoc.createElement("Output");
    profile.appendChild(outputNode);
  }
  return outputNode;
}

function getOrCreateStreamNode() {
  const outputNode = getOrCreateOutputNode();
  if (!outputNode) return null;
  let streamNode = appState.xmlDoc.querySelector("Profile > Output > LiveStream");
  if (!streamNode) {
    streamNode = appState.xmlDoc.createElement("LiveStream");
    streamNode.setAttribute("serviceName", "YouTube RTMP");
    streamNode.setAttribute("url", "rtmps://a.rtmps.youtube.com/live2");
    streamNode.setAttribute("key", "");
    streamNode.setAttribute("streamIdExtensions", "");
    streamNode.setAttribute("lowLatency", "False");
    streamNode.setAttribute("streamDownConvertMode", "None");
    const creds = appState.xmlDoc.createElement("Credentials");
    creds.setAttribute("username", "");
    creds.setAttribute("password", "");
    streamNode.appendChild(creds);
    outputNode.appendChild(streamNode);
  }
  return streamNode;
}

function getOrCreateRecordNode() {
  const outputNode = getOrCreateOutputNode();
  if (!outputNode) return null;
  let recordNode = appState.xmlDoc.querySelector("Profile > Output > Record");
  if (!recordNode) {
    recordNode = appState.xmlDoc.createElement("Record");
    const safePrefix = (appState.productName || "ATEM").replace(/[^a-zA-Z0-9]/g, "_");
    recordNode.setAttribute("filename", safePrefix);
    recordNode.setAttribute("recordInAllCameras", "False");
    recordNode.setAttribute("recordAllISOInputs", appState.hasIso ? "True" : "False");
    outputNode.appendChild(recordNode);
  }
  return recordNode;
}

function updateXMLStreamAttr(attrName, newValue) {
  const node = getOrCreateStreamNode();
  if (node) {
    node.setAttribute(attrName, newValue);
  }
}

function updateXMLStreamBitrate(nodeName, attrName, newValue) {
  let streamNode = getOrCreateStreamNode();
  if (!streamNode) return;

  let node = streamNode.querySelector(nodeName);
  if (!node) {
    node = appState.xmlDoc.createElement(nodeName);
    streamNode.appendChild(node);
  }
  node.setAttribute(attrName, newValue);
}

function updateXMLRecordAttr(attrName, newValue) {
  const node = getOrCreateRecordNode();
  if (node) {
    if (typeof newValue === "boolean") {
      node.setAttribute(attrName, newValue ? "True" : "False");
    } else {
      node.setAttribute(attrName, newValue);
    }
  }
}

// --- COUNTERS PANEL ---
function buildCountersPanel() {
  const container = document.getElementById("counters-container");
  if (!container) return;
  container.innerHTML = "";

  if (!appState.hasCounters) {
    container.innerHTML = "<p>Counters are not supported on this model.</p>";
    return;
  }

  const counters = appState.xmlDoc.querySelectorAll("Counters > Counter");
  
  if (counters.length === 0) {
    container.innerHTML = "<p>No counters configured in this XML.</p>";
    return;
  }

  counters.forEach((counterNode, idx) => {
    const cIndex = counterNode.getAttribute("index");
    const enabled = counterNode.getAttribute("enabled") === "True";
    const mode = counterNode.getAttribute("mode") || "Countdown";
    const autoHide = counterNode.getAttribute("autoHide") === "True";
    const posX = counterNode.getAttribute("positionX") || "0";
    const posY = counterNode.getAttribute("positionY") || "0";
    const size = counterNode.getAttribute("size") || "25";
    const opacity = counterNode.getAttribute("opacity") || "100";
    const startH = counterNode.getAttribute("startFromHours") || "0";
    const startM = counterNode.getAttribute("startFromMinutes") || "0";
    const startS = counterNode.getAttribute("startFromSeconds") || "0";
    const startF = counterNode.getAttribute("startFromFrames") || "0";

    const card = document.createElement("div");
    card.className = "info-card";
    card.style.marginBottom = "20px";

    card.innerHTML = `
      <h3 style="margin-top:0; border-bottom: 1px solid var(--border); padding-bottom: 10px;">Counter ${parseInt(cIndex) + 1}</h3>
      <div class="form-row">
        <!-- Left Column -->
        <div style="flex: 1;">
          <div class="form-group checkbox-group" style="margin-bottom: 15px;">
            <input type="checkbox" id="counter-enabled-${cIndex}" ${enabled ? "checked" : ""} onchange="updateXMLCounterAttr(${cIndex}, 'enabled', this.checked ? 'True' : 'False')">
            <label for="counter-enabled-${cIndex}">Enabled</label>
          </div>
          
          <div class="form-group">
            <label>Mode</label>
            <select onchange="updateXMLCounterAttr(${cIndex}, 'mode', this.value)">
              <option value="Countdown" ${mode === "Countdown" ? "selected" : ""}>Countdown</option>
              <option value="CountUp" ${mode === "CountUp" ? "selected" : ""}>Count Up</option>
              <option value="TimeOfDay" ${mode === "TimeOfDay" ? "selected" : ""}>Time of Day</option>
            </select>
          </div>

          <div class="form-group checkbox-group" style="margin-bottom: 15px;">
            <input type="checkbox" id="counter-autohide-${cIndex}" ${autoHide ? "checked" : ""} onchange="updateXMLCounterAttr(${cIndex}, 'autoHide', this.checked ? 'True' : 'False')">
            <label for="counter-autohide-${cIndex}">Auto Hide</label>
          </div>
        </div>
        
        <!-- Right Column -->
        <div style="flex: 1;">
          <div class="form-row">
            <div class="form-group" style="flex: 1;">
              <label>Position X</label>
              <input type="number" step="0.1" value="${posX}" onchange="updateXMLCounterAttr(${cIndex}, 'positionX', this.value)">
            </div>
            <div class="form-group" style="flex: 1;">
              <label>Position Y</label>
              <input type="number" step="0.1" value="${posY}" onchange="updateXMLCounterAttr(${cIndex}, 'positionY', this.value)">
            </div>
          </div>

          <div class="form-group">
            <label>Size</label>
            <input type="number" value="${size}" onchange="updateXMLCounterAttr(${cIndex}, 'size', this.value)">
          </div>
          
          <div class="form-group">
            <label>Opacity (${opacity}%)</label>
            <input type="range" min="0" max="100" value="${opacity}" onchange="updateXMLCounterAttr(${cIndex}, 'opacity', this.value)" style="width: 100%;">
          </div>
        </div>
      </div>
      
      <div style="margin-top: 20px;">
        <h4 style="margin-bottom: 10px; color: var(--text-main); font-size: 0.9rem;">Start Time (HH:MM:SS:FF)</h4>
        <div class="form-row">
          <div class="form-group" style="flex: 1; margin: 0;">
            <input type="number" min="0" max="23" value="${startH}" title="Hours" onchange="updateXMLCounterAttr(${cIndex}, 'startFromHours', this.value)" style="text-align: center;">
          </div>
          <span style="display:flex; align-items:center; font-weight:bold; color:var(--text-muted); padding: 0 5px;">:</span>
          <div class="form-group" style="flex: 1; margin: 0;">
            <input type="number" min="0" max="59" value="${startM}" title="Minutes" onchange="updateXMLCounterAttr(${cIndex}, 'startFromMinutes', this.value)" style="text-align: center;">
          </div>
          <span style="display:flex; align-items:center; font-weight:bold; color:var(--text-muted); padding: 0 5px;">:</span>
          <div class="form-group" style="flex: 1; margin: 0;">
            <input type="number" min="0" max="59" value="${startS}" title="Seconds" onchange="updateXMLCounterAttr(${cIndex}, 'startFromSeconds', this.value)" style="text-align: center;">
          </div>
          <span style="display:flex; align-items:center; font-weight:bold; color:var(--text-muted); padding: 0 5px;">:</span>
          <div class="form-group" style="flex: 1; margin: 0;">
            <input type="number" min="0" max="59" value="${startF}" title="Frames" onchange="updateXMLCounterAttr(${cIndex}, 'startFromFrames', this.value)" style="text-align: center;">
          </div>
        </div>
      </div>
    `;

    container.appendChild(card);
  });
}

function updateXMLCounterAttr(index, attrName, value) {
  const node = appState.xmlDoc.querySelector(`Counters > Counter[index="${index}"]`);
  if (node) {
    node.setAttribute(attrName, value);
    buildCountersPanel(); // Refresh UI
  }
}

function formatXml(xml) {
    // 1. Strip existing whitespace-only text nodes between tags so we can format cleanly
    let formatted = xml.replace(/>\s+</g, '><');
    
    // 2. Insert newlines between tags
    formatted = formatted.replace(/(>)(<)(\/*)/g, '$1\r\n$2$3');
    
    // 3. Format with indentation (Blackmagic natively uses 4 spaces)
    const PADDING = '    '; 
    let pad = 0;
    formatted = formatted.split('\r\n').map(node => {
        let indent = 0;
        if (node.match(/.+<\/\w[^>]*>$/)) {
            indent = 0;
        } else if (node.match(/^<\/\w/) && pad > 0) {
            pad -= 1;
        } else if (node.match(/^<\w[^>]*[^\/]>.*$/)) {
            indent = 1;
        } else {
            indent = 0;
        }
        const padding = PADDING.repeat(pad);
        pad += indent;
        return padding + node;
    }).join('\r\n');
    
    // 4. Ensure XML declaration exists at the top
    if (!formatted.startsWith('<?xml')) {
        formatted = '<?xml version="1.0" encoding="UTF-8"?>\r\n' + formatted;
    }
    
    return formatted;
}

function exportXML() {
  if (!appState.xmlDoc) {
    alert("Please upload an XML file first.");
    return;
  }
  const serializer = new XMLSerializer();
  let xmlString = serializer.serializeToString(appState.xmlDoc);
  
  // Format the XML to be readable like Blackmagic's export (4 spaces, CRLF)
  xmlString = formatXml(xmlString);

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

// ==========================================================================
// --- SECTION: RESET CONTROLLERS & TOAST NOTIFICATION ---
// ==========================================================================

/**
 * Returns a pristine clone of the initially loaded/generated XML Document
 * to support granular rollback on any tab.
 * @returns {Document|null}
 */
function getOriginalDoc() {
  if (!appState.originalXmlString) return null;
  const parser = new DOMParser();
  return parser.parseFromString(appState.originalXmlString, "text/xml");
}

/**
 * Resets Input labels, Output labels, and Audio mixOptions back to the initial XML state.
 */
function resetLabelsTab() {
  const origDoc = getOriginalDoc();
  if (!origDoc || !appState.xmlDoc) return;

  // Restore Inputs
  const origInputs = origDoc.querySelector("Inputs");
  const currInputs = appState.xmlDoc.querySelector("Inputs");
  if (origInputs && currInputs) {
    currInputs.replaceWith(appState.xmlDoc.importNode(origInputs, true));
  }

  // Restore Outputs
  const origOutputs = origDoc.querySelector("Outputs");
  const currOutputs = appState.xmlDoc.querySelector("Outputs");
  if (origOutputs && currOutputs) {
    currOutputs.replaceWith(appState.xmlDoc.importNode(origOutputs, true));
  }

  // Restore Audio inputs mixOptions
  if (appState.hasFairlight) {
    const origFl = origDoc.querySelector("FairlightAudioMixer AudioInputs");
    const currFl = appState.xmlDoc.querySelector("FairlightAudioMixer AudioInputs");
    if (origFl && currFl) {
      currFl.replaceWith(appState.xmlDoc.importNode(origFl, true));
    }
  } else {
    const origMix = origDoc.querySelector("AudioMixer AudioInputs");
    const currMix = appState.xmlDoc.querySelector("AudioMixer AudioInputs");
    if (origMix && currMix) {
      currMix.replaceWith(appState.xmlDoc.importNode(origMix, true));
    }
  }

  cacheInputNames();
  cacheAudioMixOptions();
  buildLabelsTable();
  buildAuxMatrix();
  buildMultiview();
  buildAudioMapping();
  showToast("Input and Output labels reset to initial state");
}

/**
 * Resets Auxiliary output routing crosspoints back to the initial XML state.
 */
function resetAuxTab() {
  const origDoc = getOriginalDoc();
  if (!origDoc || !appState.xmlDoc) return;

  const origAux = origDoc.querySelector("Auxiliaries");
  const currAux = appState.xmlDoc.querySelector("Auxiliaries");
  if (origAux && currAux) {
    currAux.replaceWith(appState.xmlDoc.importNode(origAux, true));
  }
  buildAuxMatrix();
  showToast("Auxiliary matrix routing reset to initial state");
}

/**
 * Resets Multiview layout and window source assignments back to the initial XML state.
 */
function resetMultiviewTab() {
  const origDoc = getOriginalDoc();
  if (!origDoc || !appState.xmlDoc) return;

  const origMvs = origDoc.querySelector("MultiViews");
  const currMvs = appState.xmlDoc.querySelector("MultiViews");
  if (origMvs && currMvs) {
    currMvs.replaceWith(appState.xmlDoc.importNode(origMvs, true));
  }
  buildMultiview();
  showToast("Multiview configuration reset to initial state");
}

/**
 * Resets Fairlight / MADI audio output routing back to the initial XML state.
 */
function resetAudioTab() {
  const origDoc = getOriginalDoc();
  if (!origDoc || !appState.xmlDoc) return;

  const origMap = origDoc.querySelector("AudioMapping");
  const currMap = appState.xmlDoc.querySelector("AudioMapping");
  if (origMap && currMap) {
    currMap.replaceWith(appState.xmlDoc.importNode(origMap, true));
  }
  buildAudioMapping();
  showToast("Audio output mapping reset to initial state");
}

/**
 * Resets Live Streaming and Recording settings back to initial XML state.
 */
function resetStreamRecordTab() {
  const origDoc = getOriginalDoc();
  if (!origDoc || !appState.xmlDoc) return;

  const origLs = origDoc.querySelector("Profile > Output > LiveStream");
  const currLs = appState.xmlDoc.querySelector("Profile > Output > LiveStream");
  if (origLs && currLs) {
    currLs.replaceWith(appState.xmlDoc.importNode(origLs, true));
  }

  const origRec = origDoc.querySelector("Profile > Output > Record");
  const currRec = appState.xmlDoc.querySelector("Profile > Output > Record");
  if (origRec && currRec) {
    currRec.replaceWith(appState.xmlDoc.importNode(origRec, true));
  }

  buildStreamRecordPanel();
  showToast("Stream & Record settings reset to initial state");
}

/**
 * Resets On-Screen Counters (clocks/timers) back to initial XML state.
 */
function resetCountersTab() {
  const origDoc = getOriginalDoc();
  if (!origDoc || !appState.xmlDoc) return;

  const origCnt = origDoc.querySelector("Counters");
  const currCnt = appState.xmlDoc.querySelector("Counters");
  if (origCnt && currCnt) {
    currCnt.replaceWith(appState.xmlDoc.importNode(origCnt, true));
  }
  buildCountersPanel();
  showToast("Counters reset to initial state");
}

/**
 * Resets the entire application session, unloading the active XML and restoring
 * the initial landing state without requiring a browser reload.
 */
function resetEntireSession() {
  if (appState.xmlDoc && !confirm("Are you sure you want to unload the current switcher configuration and start over?")) {
    return;
  }

  // Clear application state
  appState.xmlDoc = null;
  appState.originalXmlString = null;
  appState.productName = "";
  appState.tier = "";
  appState.generation = "legacy";
  appState.audioEngine = "legacy";
  appState.superSourceCount = 0;
  appState.multiviewCount = 1;
  appState.mvLayoutType = "text";
  appState.hasSuperSource = false;
  appState.hasFairlight = false;
  appState.hasAudioMapping = false;
  appState.hasMadi = false;
  appState.hasIso = false;
  appState.hasNetworkIngest = false;
  appState.inputsMap.clear();
  appState.mixOptionsMap.clear();
  appState.activeMvIndex = null;
  appState.activeWindowIndex = null;
  appState.isLive = false;

  // Reset Header
  document.getElementById("active-switcher-name").innerText = "No XML Loaded";
  const resetBtn = document.getElementById("btn-reset-session");
  if (resetBtn) resetBtn.style.display = "none";

  // Reset Overview UI elements
  const dropZone = document.getElementById("drop-zone");
  if (dropZone) {
    dropZone.style.display = "block";
    dropZone.classList.remove("drop-zone-active");
    dropZone.innerHTML = `
      <h2>Drag &amp; Drop ATEM XML Here</h2>
      <p>Or click to browse files</p>
      <input type="file" id="file-input" accept=".xml" style="display:none;">
    `;
    const fileInput = document.getElementById("file-input");
    dropZone.onclick = () => fileInput.click();
    fileInput.onchange = (e) => {
      if (e.target.files.length) processFile(e.target.files[0]);
    };
  }

  const createZone = document.querySelector(".create-scratch-zone");
  if (createZone) createZone.style.display = "block";

  const usageCard = document.querySelector(".card-usage");
  if (usageCard) usageCard.style.display = "block";

  const systemInfo = document.getElementById("system-info");
  if (systemInfo) systemInfo.style.display = "none";

  // Disable nav buttons that require XML
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    if (btn.getAttribute("data-target") !== "tab-overview") {
      btn.disabled = true;
    }
  });

  // Switch to Overview tab
  const overviewBtn = document.querySelector('[data-target="tab-overview"]');
  if (overviewBtn) overviewBtn.click();

  showToast("Session reset — ready for new XML");
}

/**
 * Displays a non-intrusive floating toast notification.
 * @param {string} message
 */
function showToast(message) {
  let toast = document.getElementById("app-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "app-toast";
    toast.className = "app-toast";
    document.body.appendChild(toast);
  }
  toast.innerText = message;
  toast.classList.add("show");
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => {
    toast.classList.remove("show");
  }, 2500);
}



