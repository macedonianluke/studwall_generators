import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Download, Plus, Trash2, Settings, Move, ZoomIn, RotateCw, X, Grid, FileText, Sparkles, CheckCircle, AlertTriangle, Layers, ShoppingCart } from 'lucide-react';

// --- HELPERS ---
const TIMBER_SIZES = {
  '70x35': { d: 70, t: 35, grade: 'MGP10' },
  '90x35': { d: 90, t: 35, grade: 'MGP10' },
  '90x45': { d: 90, t: 45, grade: 'MGP10' },
  '140x45': { d: 140, t: 45, grade: 'MGP12' }
};

const COMMON_ORDER_LENGTHS = [2400, 2700, 3000, 3600, 4200, 4800, 5400, 6000];

const DEFAULT_VIEW = { rotX: 20, rotY: -35, zoom: 0.8, panX: 0, panY: 50 };

// Shared rotation helper for both Canvas Render and OBJ Export
const rotatePoint = (px, py, angleDeg) => {
  if (!angleDeg) return { x: px, y: py };
  const rad = angleDeg * (Math.PI / 180);
  return {
      x: px * Math.cos(rad) - py * Math.sin(rad),
      y: px * Math.sin(rad) + py * Math.cos(rad)
  };
};

const AS1684WallGenerator = () => {
  // --- STATE ---
  // Inputs kept as flexible types (string while typing, number from AI)
  const [wallLength, setWallLength] = useState(3600);
  const [wallHeight, setWallHeight] = useState(2400);
  const [studSize, setStudSize] = useState('90x45');
  const [studSpacing, setStudSpacing] = useState(450);
  const [openings, setOpenings] = useState([]);
  const [showBracing, setShowBracing] = useState(true);
  const [includeWaste, setIncludeWaste] = useState(true);
  const [view3D, setView3D] = useState(DEFAULT_VIEW);
  const [activeTab, setActiveTab] = useState('controls'); 
  const [showSettings, setShowSettings] = useState(true);

  // AI State
  const [aiPrompt, setAiPrompt] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aiResponse, setAiResponse] = useState(null);
  const [aiAnalysis, setAiAnalysis] = useState(null);

  // Mouse interaction state
  const [isDragging, setIsDragging] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  const canvasRef = useRef(null);

  // --- GEMINI API HELPERS ---
  const callGemini = async (userPrompt, systemInstruction, isJson = false) => {
    const apiKey = ""; // Provided by environment
    setIsAiLoading(true);
    setAiResponse(null);
    setAiAnalysis(null);
    
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: userPrompt }] }],
            systemInstruction: { parts: [{ text: systemInstruction }] },
            generationConfig: isJson ? { responseMimeType: "application/json" } : {}
          }),
        }
      );

      if (!response.ok) throw new Error(`API Error: ${response.status}`);
      const data = await response.json();
      const resultText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      
      setIsAiLoading(false);
      return resultText;
    } catch (error) {
      console.error("Gemini API Error:", error);
      setIsAiLoading(false);
      setAiResponse(`Error: ${error.message}`);
      return null;
    }
  };

  const handleAIGenerate = async () => {
    if (!aiPrompt.trim()) return;

    const systemPrompt = `
      You are a structural CAD generator assistant. 
      Extract wall parameters from the user's description.
      
      Output JSON format:
      {
        "wallLength": number (mm, default 3600),
        "wallHeight": number (mm, default 2400),
        "studSpacing": number (450 or 600, default 450),
        "openings": [
          { "startX": number (mm from left), "width": number, "height": number, "sillHeight": number (0 for doors, ~900 for windows) }
        ]
      }
      
      Rules:
      - Standard door is ~2100 high x 820-920 wide. Sill height 0.
      - Standard window is ~900-1200 high. Sill height ~900.
      - Ensure startX keeps items within the wall length.
    `;

    const jsonString = await callGemini(aiPrompt, systemPrompt, true);
    
    if (jsonString) {
      try {
        const specs = JSON.parse(jsonString);
        if (specs.wallLength) setWallLength(specs.wallLength);
        if (specs.wallHeight) setWallHeight(specs.wallHeight);
        if (specs.studSpacing) setStudSpacing(specs.studSpacing);
        if (specs.openings) setOpenings(specs.openings.map(o => ({ ...o, id: Date.now() + Math.random() })));
        setAiResponse("Wall updated based on your description!");
      } catch (e) {
        setAiResponse("Failed to parse AI design. Try being more specific.");
      }
    }
  };

  const handleAIComplianceCheck = async () => {
    const context = {
      wallLength,
      wallHeight,
      studSize,
      studSpacing,
      timberGrade: TIMBER_SIZES[studSize]?.grade || 'Unknown',
      openingsCount: openings.length
    };

    const systemPrompt = `
      You are an expert Structural Engineer specializing in AS 1684.
      Analyze the JSON wall data.
      Provide a brief 3-point assessment focusing on:
      1. Slenderness ratio risks.
      2. Stud spacing appropriateness.
      3. Lintel checks.
    `;

    const advice = await callGemini(JSON.stringify(context), systemPrompt, false);
    setAiAnalysis(advice);
  };

  // --- LOGIC ENGINE ---
  const generateFrame = useMemo(() => {
    try {
        // --- INPUT SANITIZATION ---
        // Ensure inputs are numbers for calculation, regardless of current input state
        const numWallLen = parseFloat(wallLength) || 0;
        const numWallHeight = parseFloat(wallHeight) || 0;
        const numSpacing = parseFloat(studSpacing) || 450;

        const { d: depth, t: thickness } = TIMBER_SIZES[studSize] || TIMBER_SIZES['90x45'];
        const components = [];
        const verticalMembers = []; 

        const addMember = (type, x, y, z, len, w, d_dim, color, rotation = 0) => {
          
          let cutLength = 0;
          let sectionSize = "";

          if (type.includes('Stud')) {
             cutLength = w;
             sectionSize = `${d_dim}x${Math.round(len)}`;
          } else if (type.includes('Plate') || type.includes('Noggin') || type.includes('Sill') || type.includes('Trimmer')) {
             cutLength = len;
             sectionSize = `${d_dim}x${Math.round(w)}`;
          } else if (type.includes('Lintel')) {
             cutLength = len;
             sectionSize = `${Math.round(w)}x${d_dim}`;
          } else if (type.includes('Brace')) {
             cutLength = len;
             sectionSize = "Metal Strap";
          }

          components.push({
            id: Math.random().toString(36).substr(2, 9),
            type, x, y, z, len, w, d: d_dim, color, rotation,
            cutLength: Math.round(cutLength),
            sectionSize
          });
        };

        // A. PLATES
        const plateStartX = -thickness / 2;
        const fullPlateLength = numWallLen + thickness;

        // Bottom Plate Logic
        let currentX = plateStartX;
        const sortedOpenings = [...openings].sort((a, b) => (parseFloat(a.startX)||0) - (parseFloat(b.startX)||0));
        const doorOpenings = sortedOpenings.filter(o => (parseFloat(o.sillHeight)||0) === 0);
        
        if (doorOpenings.length === 0) {
          addMember('Bottom Plate', plateStartX, 0, 0, fullPlateLength, thickness, depth, '#8B5A2B');
        } else {
          let plateX = plateStartX;
          doorOpenings.forEach(door => {
            const dStart = parseFloat(door.startX) || 0;
            const dWidth = parseFloat(door.width) || 0;
            
            const doorCutStart = dStart;
            if (doorCutStart > plateX) {
              addMember('Bottom Plate', plateX, 0, 0, doorCutStart - plateX, thickness, depth, '#8B5A2B');
            }
            plateX = dStart + dWidth;
          });
          const finalPlateEnd = numWallLen + thickness/2;
          if (plateX < finalPlateEnd) {
            addMember('Bottom Plate', plateX, 0, 0, finalPlateEnd - plateX, thickness, depth, '#8B5A2B');
          }
        }

        // Top Plates
        addMember('Top Plate (Lower)', plateStartX, numWallHeight - (thickness * 2), 0, fullPlateLength, thickness, depth, '#A0522D');
        addMember('Top Plate (Upper)', plateStartX, numWallHeight - thickness, 0, fullPlateLength, thickness, depth, '#A0522D');

        // B. STUDS
        const gridPositions = [];
        const safeSpacing = Math.max(100, numSpacing); 
        for (let x = 0; x <= numWallLen; x += safeSpacing) gridPositions.push(x);
        if (gridPositions[gridPositions.length - 1] !== numWallLen) gridPositions.push(numWallLen);

        gridPositions.forEach(xPos => {
          let startY = thickness;
          let endY = numWallHeight - (thickness * 2);
          let isDeleted = false;
          let lowerStud = null;
          let upperStud = null;

          for (const op of openings) {
            const opStart = parseFloat(op.startX) || 0;
            const opWidth = parseFloat(op.width) || 0;
            const opHeight = parseFloat(op.height) || 0;
            const opSill = parseFloat(op.sillHeight) || 0;
            const opEnd = opStart + opWidth;

            if (xPos > opStart + 10 && xPos < opEnd - 10) {
              isDeleted = true;
              if (opSill > 0) {
                lowerStud = { y: thickness, h: opSill - thickness };
              }
              let lintelDepth = opWidth > 1200 ? 190 : 140; 
              const spaceAbove = (numWallHeight - (thickness * 2)) - (opSill + opHeight + lintelDepth);
              if (spaceAbove > 20) {
                 upperStud = { y: opSill + opHeight + lintelDepth, h: spaceAbove };
              }
              break;
            }
          }

          const studX = xPos - (thickness/2);

          if (!isDeleted) {
            addMember('Common Stud', studX, startY, 0, thickness, endY - startY, depth, '#DEB887');
            verticalMembers.push({ x: studX, type: 'common' });
          } else {
            if (lowerStud) addMember('Jack Stud', studX, lowerStud.y, 0, thickness, lowerStud.h, depth, '#EECFA1');
            if (upperStud) addMember('Cripple Stud', studX, upperStud.y, 0, thickness, upperStud.h, depth, '#EECFA1');
          }
        });

        // C. OPENINGS
        openings.forEach(op => {
          const opStart = parseFloat(op.startX) || 0;
          const opWidth = parseFloat(op.width) || 0;
          const opHeight = parseFloat(op.height) || 0;
          const opSill = parseFloat(op.sillHeight) || 0;

          let lintelDepth = opWidth > 1200 ? 190 : 140;
          const headHeight = opSill + opHeight;
          
          const leftJambX = opStart - thickness;
          addMember('Jamb Stud', leftJambX, thickness, 0, thickness, headHeight + lintelDepth - thickness, depth, '#CD853F');
          verticalMembers.push({ x: leftJambX, type: 'jamb' });

          const rightJambX = opStart + opWidth;
          addMember('Jamb Stud', rightJambX, thickness, 0, thickness, headHeight + lintelDepth - thickness, depth, '#CD853F');
          verticalMembers.push({ x: rightJambX, type: 'jamb' });

          addMember('Lintel', opStart - thickness, headHeight, 0, opWidth + (thickness * 2), lintelDepth, depth, '#8B4513');
          if (opSill > 0) addMember('Sill Trimmer', opStart, opSill, 0, opWidth, thickness, depth, '#A0522D');
        });

        // D. NOGGINS
        verticalMembers.sort((a, b) => a.x - b.x);
        const uniqueVerticals = verticalMembers.filter((v, i, a) => i === 0 || Math.abs(v.x - a[i-1].x) > 1);
        const nogginCenter = numWallHeight / 2;

        for (let i = 0; i < uniqueVerticals.length - 1; i++) {
            const v1 = uniqueVerticals[i];
            const v2 = uniqueVerticals[i+1];
            const gapStart = v1.x + thickness;
            const gapEnd = v2.x;
            const gapWidth = gapEnd - gapStart;

            if (gapWidth < 10) continue; 

            const midX = (gapStart + gapEnd) / 2;
            let insideOpening = false;
            for (const op of openings) {
                const opStart = parseFloat(op.startX) || 0;
                const opWidth = parseFloat(op.width) || 0;
                const opSill = parseFloat(op.sillHeight) || 0;
                const opHeight = parseFloat(op.height) || 0;

                if (midX > opStart && midX < opStart + opWidth) {
                    const opTop = opSill + opHeight;
                    const opBottom = opSill;
                    if (nogginCenter > opBottom && nogginCenter < opTop) {
                        insideOpening = true;
                        break;
                    }
                }
            }

            if (!insideOpening) {
                const yPos = (i % 2 === 0) ? nogginCenter + 25 : nogginCenter - 25;
                addMember('Noggin', gapStart, yPos, 0, gapWidth, thickness, depth, '#BC8F8F');
            }
        }

        // E. BRACING
        if (showBracing) {
           const solidPanels = [];
           let currentStart = 0;
           const allOps = [...openings].sort((a,b) => (parseFloat(a.startX)||0) - (parseFloat(b.startX)||0));
           
           allOps.forEach(op => {
               const opStart = parseFloat(op.startX) || 0;
               const opWidth = parseFloat(op.width) || 0;
               if (opStart > currentStart) {
                   solidPanels.push({ start: currentStart, end: opStart });
               }
               currentStart = Math.max(currentStart, opStart + opWidth);
           });
           
           if (currentStart < numWallLen) {
               solidPanels.push({ start: currentStart, end: numWallLen });
           }

           solidPanels.forEach(panel => {
               const panelWidth = panel.end - panel.start;
               if (panelWidth > 1200) {
                   const padding = 150;
                   const braceRun = panelWidth - (padding * 2);
                   if (braceRun > 500) {
                      const braceRise = numWallHeight - 200; 
                      const braceLen = Math.sqrt(Math.pow(braceRun, 2) + Math.pow(braceRise, 2));
                      const angleRad = Math.atan2(braceRise, braceRun);
                      const angleDeg = angleRad * (180 / Math.PI);
                      
                      addMember('Metal Brace', panel.start + padding, 100, depth, braceLen, 40, 2, '#708090', angleDeg);
                   }
               }
           });
        }

        return components;
    } catch (err) {
        console.error("Frame generation error:", err);
        return [];
    }
  }, [wallLength, wallHeight, studSize, studSpacing, openings, showBracing]);

  // --- BOM & STOCK OPTIMIZATION ENGINE ---
  const bomData = useMemo(() => {
    if (!generateFrame) return {};
    
    // 1. Group raw items
    const rawGroups = {};
    generateFrame.forEach(item => {
      const sizeKey = item.sectionSize || "Misc";
      if (!rawGroups[sizeKey]) rawGroups[sizeKey] = { pieces: [], cutList: {}, totalLM: 0 };
      
      // Add to pieces list for bin packing
      rawGroups[sizeKey].pieces.push(item.cutLength);
      
      // Add to cut list display
      const itemKey = `${item.type} @ ${item.cutLength}mm`;
      if (!rawGroups[sizeKey].cutList[itemKey]) {
        rawGroups[sizeKey].cutList[itemKey] = {
          type: item.type,
          len: item.cutLength,
          count: 0
        };
      }
      rawGroups[sizeKey].cutList[itemKey].count++;
      rawGroups[sizeKey].totalLM += item.cutLength;
    });

    // 2. Perform Stock Optimization (Bin Packing)
    // For each timber size, calculate the best way to buy stock lengths
    Object.keys(rawGroups).forEach(sizeKey => {
      if (sizeKey === 'Metal Strap' || sizeKey === 'Misc') return; // Don't optimize metal

      const pieces = [...rawGroups[sizeKey].pieces].sort((a, b) => b - a); // Sort Descending
      const bins = []; // Each bin: { capacity: number, used: number, cuts: [] }

      pieces.forEach(piece => {
        // Simple First Fit Decreasing algorithm
        let fitted = false;
        
        // Try to fit in existing open bin
        for (let bin of bins) {
          if (bin.remaining >= piece + 5) { // +5mm kerf allowance
            bin.remaining -= (piece + 5);
            bin.cuts.push(piece);
            fitted = true;
            break;
          }
        }

        // If not fitted, create new bin
        if (!fitted) {
          // Find the smallest standard length that fits this piece
          const bestStock = COMMON_ORDER_LENGTHS.find(l => l >= piece);
          if (bestStock) {
            bins.push({
              length: bestStock,
              remaining: bestStock - piece - 5, // Initial cut also needs kerf usually if trimmed
              cuts: [piece]
            });
          } else {
            // Piece is longer than any standard stock (e.g. huge lintel)
            // Just order a custom long length (or largest + excess)
            bins.push({
              length: Math.ceil(piece / 600) * 600, // Round up to nearest 600mm
              remaining: 0,
              cuts: [piece]
            });
          }
        }
      });

      // Consolidate bins into an order list
      const orderSummary = {};
      bins.forEach(bin => {
        if (!orderSummary[bin.length]) orderSummary[bin.length] = 0;
        orderSummary[bin.length]++;
      });
      
      rawGroups[sizeKey].orderList = orderSummary;
    });
    
    return rawGroups;
  }, [generateFrame]);

  // --- RENDERING ENGINE ---
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    ctx.fillStyle = '#1a1d26';
    ctx.fillRect(0, 0, width, height);
    
    if (!generateFrame || generateFrame.length === 0) return;

    // Use sanitized numbers for render calculation
    const numWallLen = parseFloat(wallLength) || 0;
    const numWallHeight = parseFloat(wallHeight) || 0;

    const { d: studDepth } = TIMBER_SIZES[studSize] || TIMBER_SIZES['90x45'];
    const cx = numWallLen / 2;
    const cy = numWallHeight / 2;
    const cz = studDepth / 2;
    const scale = Math.min(width / (numWallLen * 1.4), height / (numWallHeight * 1.4)) * view3D.zoom;
    
    const project = (x, y, z) => {
      let dx = x - cx;
      let dy = y - cy;
      let dz = z - cz;

      const radY = view3D.rotY * (Math.PI / 180);
      const radX = view3D.rotX * (Math.PI / 180);

      let x1 = dx * Math.cos(radY) - dz * Math.sin(radY);
      let z1 = dx * Math.sin(radY) + dz * Math.cos(radY);

      let y2 = dy * Math.cos(radX) - z1 * Math.sin(radX);
      let z2 = dy * Math.sin(radX) + z1 * Math.cos(radX);

      const dist = 2000 + z2;
      const f = 2000 / (dist < 100 ? 100 : dist);
      
      return {
        x: (width / 2) + (x1 * f) * scale + view3D.panX,
        y: (height / 2) - (y2 * f) * scale + view3D.panY,
        z: z2
      };
    };

    let allFaces = [];

    generateFrame.forEach(comp => {
      const { x, y, z, len, w, d, color, rotation } = comp;
      
      const rawVerts = [
        {x: 0, y: 0, z: 0}, {x: len, y: 0, z: 0}, {x: len, y: w, z: 0}, {x: 0, y: w, z: 0},
        {x: 0, y: 0, z: d}, {x: len, y: 0, z: d}, {x: len, y: w, z: d}, {x: 0, y: w, z: d}
      ];

      const worldVerts = rawVerts.map(v => {
          const rot = rotatePoint(v.x, v.y, rotation);
          return { x: x + rot.x, y: y + rot.y, z: z + v.z };
      });

      const p = worldVerts.map(pt => project(pt.x, pt.y, pt.z));

      const faces = [
        { v: [0, 1, 2, 3], c: color },
        { v: [5, 4, 7, 6], c: adjustColor(color, -20) },
        { v: [4, 0, 3, 7], c: adjustColor(color, -10) },
        { v: [1, 5, 6, 2], c: adjustColor(color, -10) },
        { v: [3, 2, 6, 7], c: adjustColor(color, 20) },
        { v: [4, 5, 1, 0], c: adjustColor(color, -30) }
      ];

      faces.forEach(face => {
        const zDepth = (p[face.v[0]].z + p[face.v[1]].z + p[face.v[2]].z + p[face.v[3]].z) / 4;
        allFaces.push({ pts: face.v.map(i => p[i]), z: zDepth, color: face.c });
      });
    });

    allFaces.sort((a, b) => b.z - a.z);

    allFaces.forEach(f => {
      ctx.beginPath();
      ctx.moveTo(f.pts[0].x, f.pts[0].y);
      ctx.lineTo(f.pts[1].x, f.pts[1].y);
      ctx.lineTo(f.pts[2].x, f.pts[2].y);
      ctx.lineTo(f.pts[3].x, f.pts[3].y);
      ctx.closePath();
      ctx.fillStyle = f.color;
      ctx.fill();
      ctx.strokeStyle = '#00000040';
      ctx.lineWidth = 0.5;
      ctx.stroke();
    });

  }, [generateFrame, view3D, wallLength, wallHeight, studSize]);

  const adjustColor = (hex, amount) => {
    return '#' + hex.replace(/^#/, '').replace(/../g, color => ('0' + Math.min(255, Math.max(0, parseInt(color, 16) + amount)).toString(16)).substr(-2));
  }

  const handleExport = () => {
    let obj = `# AS 1684 Export\n`;
    let vc = 1;
    generateFrame.forEach((m, i) => {
      obj += `o ${m.type.replace(/\s/g, '_')}_${i}\n`;
      
      const rawVerts = [
        {x: 0, y: 0, z: 0}, {x: m.len, y: 0, z: 0}, {x: m.len, y: m.w, z: 0}, {x: 0, y: m.w, z: 0},
        {x: 0, y: 0, z: m.d}, {x: m.len, y: 0, z: m.d}, {x: m.len, y: m.w, z: m.d}, {x: 0, y: m.w, z: m.d}
      ];

      const v = rawVerts.map(v => {
          const rot = rotatePoint(v.x, v.y, m.rotation);
          return { x: m.x + rot.x, y: m.y + rot.y, z: m.z + v.z };
      });

      v.forEach(vt => obj += `v ${vt.x.toFixed(2)} ${vt.y.toFixed(2)} ${vt.z.toFixed(2)}\n`);
      
      const f = [[1,2,3,4],[5,8,7,6],[1,5,6,2],[2,6,7,3],[3,7,8,4],[5,1,4,8]];
      f.forEach(fa => obj += `f ${fa[0]+vc-1} ${fa[1]+vc-1} ${fa[2]+vc-1} ${fa[3]+vc-1}\n`);
      vc += 8;
    });
    const blob = new Blob([obj], {type: 'text/plain'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'frame.obj';
    a.click();
  };

  const handleMouseDown = (e) => {
    if (e.shiftKey) setIsPanning(true);
    else setIsDragging(true);
    setDragStart({ x: e.clientX, y: e.clientY });
  };

  const handleMouseMove = (e) => {
    if (!isDragging && !isPanning) return;
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    setDragStart({ x: e.clientX, y: e.clientY });
    if (isPanning) setView3D(v => ({ ...v, panX: v.panX + dx, panY: v.panY + dy }));
    else setView3D(v => ({ ...v, rotY: v.rotY + dx * 0.5, rotX: Math.max(-90, Math.min(90, v.rotX - dy * 0.5)) }));
  };

  return (
    <div className="w-full h-screen bg-gray-950 text-gray-100 flex overflow-hidden font-sans">
      
      {/* SIDEBAR */}
      <div className={`flex-shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col transition-all ${showSettings ? 'w-80' : 'w-0 overflow-hidden'}`}>
        <div className="p-4 border-b border-gray-800 flex justify-between items-center">
          <h1 className="font-bold flex items-center gap-2"><Settings className="w-5 h-5 text-blue-500" /> Wall Builder</h1>
          <div className="flex gap-1 bg-gray-800 rounded p-1">
             <button onClick={() => setActiveTab('controls')} className={`px-2 py-1 text-xs rounded ${activeTab==='controls'?'bg-blue-600':'hover:bg-gray-700'}`}>Edit</button>
             <button onClick={() => setActiveTab('bom')} className={`px-2 py-1 text-xs rounded ${activeTab==='bom'?'bg-blue-600':'hover:bg-gray-700'}`}>BOM</button>
             <button onClick={() => setActiveTab('ai')} className={`px-2 py-1 text-xs rounded flex items-center gap-1 ${activeTab==='ai'?'bg-purple-600':'hover:bg-gray-700'}`}><Sparkles className="w-3 h-3"/> AI</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {activeTab === 'controls' && (
            <>
              <section className="space-y-3">
                <h3 className="text-xs font-bold text-gray-500 uppercase">Dimensions</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="text-xs text-gray-400">Length</label><input type="text" value={wallLength} onChange={e => setWallLength(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded p-1.5 text-sm" /></div>
                  <div><label className="text-xs text-gray-400">Height</label><input type="text" value={wallHeight} onChange={e => setWallHeight(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded p-1.5 text-sm" /></div>
                </div>
              </section>
              <section className="space-y-3">
                <h3 className="text-xs font-bold text-gray-500 uppercase">Structure</h3>
                <div className="space-y-2">
                  <select value={studSize} onChange={e => setStudSize(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded p-1.5 text-sm">{Object.keys(TIMBER_SIZES).map(s => <option key={s} value={s}>{s}</option>)}</select>
                  <select value={studSpacing} onChange={e => setStudSpacing(Number(e.target.value))} className="w-full bg-gray-800 border border-gray-700 rounded p-1.5 text-sm"><option value={450}>450mm</option><option value={600}>600mm</option></select>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={showBracing} onChange={e => setShowBracing(e.target.checked)} /> <span className="text-sm">Bracing</span></label>
                </div>
              </section>
              <section className="space-y-3">
                <div className="flex justify-between"><h3 className="text-xs font-bold text-gray-500 uppercase">Openings</h3><button onClick={() => setOpenings([...openings, { id: Date.now(), startX: 1000, width: 900, height: 2100, sillHeight: 0 }])} className="text-blue-400"><Plus className="w-4 h-4"/></button></div>
                <div className="space-y-2">
                  {openings.map((op, idx) => (
                    <div key={op.id} className="bg-gray-800 p-2 rounded border border-gray-700 text-sm space-y-2">
                      <div className="flex justify-between text-xs text-gray-400"><span>#{idx+1}</span><button onClick={() => setOpenings(openings.filter(o => o.id !== op.id))} className="text-red-400"><Trash2 className="w-3 h-3"/></button></div>
                      <div className="grid grid-cols-2 gap-2">
                        <div><label className="text-[10px]">Start X</label><input type="text" value={op.startX} onChange={e => { const n = [...openings]; n[idx].startX = e.target.value; setOpenings(n); }} className="w-full bg-gray-900 border border-gray-700 rounded px-1" /></div>
                        <div><label className="text-[10px]">Width</label><input type="text" value={op.width} onChange={e => { const n = [...openings]; n[idx].width = e.target.value; setOpenings(n); }} className="w-full bg-gray-900 border border-gray-700 rounded px-1" /></div>
                        <div><label className="text-[10px]">Height</label><input type="text" value={op.height} onChange={e => { const n = [...openings]; n[idx].height = e.target.value; setOpenings(n); }} className="w-full bg-gray-900 border border-gray-700 rounded px-1" /></div>
                        <div><label className="text-[10px]">Sill</label><input type="text" value={op.sillHeight} onChange={e => { const n = [...openings]; n[idx].sillHeight = e.target.value; setOpenings(n); }} className="w-full bg-gray-900 border border-gray-700 rounded px-1" /></div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}

          {activeTab === 'bom' && (
            <div className="space-y-4">
               <div className="flex items-center justify-between">
                 <h3 className="text-xs font-bold text-gray-500 uppercase flex gap-2"><ShoppingCart className="w-4 h-4"/> Order List</h3>
                 <span className="text-[10px] text-gray-500">Based on common AU lengths</span>
               </div>
               
               <div className="space-y-4">
                 {Object.keys(bomData).sort().map(section => (
                   <div key={section} className="bg-gray-800 rounded border border-gray-700 overflow-hidden text-xs">
                     <div className="bg-gray-900 p-2 font-bold text-blue-400 flex justify-between items-center">
                       <span>{section}</span>
                       <span className="text-gray-500 text-[10px]">
                         {((bomData[section].totalLM) / 1000).toFixed(1)}m Total
                       </span>
                     </div>
                     
                     {/* ORDER LIST */}
                     {bomData[section].orderList && (
                       <div className="bg-blue-900/20 p-2 border-b border-gray-700">
                         <div className="font-semibold text-blue-200 mb-1 text-[10px] uppercase tracking-wider">Buy:</div>
                         <div className="flex flex-wrap gap-2">
                           {Object.entries(bomData[section].orderList).sort((a,b)=>b[0]-a[0]).map(([len, count]) => (
                             <span key={len} className="bg-blue-600 text-white px-2 py-0.5 rounded text-[11px] font-mono">
                               {count}x {len}mm
                             </span>
                           ))}
                         </div>
                       </div>
                     )}

                     {/* CUT LIST TOGGLE/DISPLAY */}
                     <div className="p-2">
                        <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Cutting List:</div>
                        <div className="space-y-1">
                          {Object.values(bomData[section].cutList).sort((a,b) => b.len - a.len).map((item, i) => (
                            <div key={i} className="flex justify-between border-b border-gray-700/50 pb-0.5 last:border-0">
                              <span className="text-gray-300">{item.type}</span>
                              <span className="font-mono text-gray-400">{item.count} @ {item.len}mm</span>
                            </div>
                          ))}
                        </div>
                     </div>
                   </div>
                 ))}
               </div>

               <div className="pt-2 border-t border-gray-700">
                  <button onClick={handleAIComplianceCheck} disabled={isAiLoading} className="w-full bg-gray-800 p-2 rounded text-sm flex justify-center gap-2 border border-gray-700 hover:bg-gray-700 transition">{isAiLoading?'Checking...':<><CheckCircle className="w-4 h-4 text-green-500"/> Check Compliance</>}</button>
                  {aiAnalysis && <div className="mt-2 bg-blue-900/30 p-2 rounded text-xs text-blue-200 whitespace-pre-wrap">{aiAnalysis}</div>}
               </div>
            </div>
          )}

          {activeTab === 'ai' && (
            <div className="space-y-4">
              <div className="bg-purple-900/30 border border-purple-500/30 p-3 rounded">
                <h3 className="font-bold flex items-center gap-2"><Sparkles className="w-4 h-4 text-yellow-300"/> AI Designer</h3>
                <p className="text-xs text-purple-200 mt-1">Describe your wall (e.g. "5m long, 2.7m high with a sliding door in middle")</p>
              </div>
              <textarea value={aiPrompt} onChange={e => setAiPrompt(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-sm h-32" placeholder="Describe wall..." />
              <button onClick={handleAIGenerate} disabled={isAiLoading} className="w-full bg-purple-600 hover:bg-purple-500 text-white p-2 rounded text-sm font-bold shadow">{isAiLoading ? 'Designing...' : 'Generate Design'}</button>
              {aiResponse && <div className="p-2 bg-gray-800 rounded text-xs border border-gray-700">{aiResponse}</div>}
            </div>
          )}
        </div>
      </div>

      {/* CANVAS AREA */}
      <div className="flex-1 relative bg-[#12141a]">
        <div className="absolute top-4 right-4 flex gap-2 z-10">
           <button onClick={() => setView3D(DEFAULT_VIEW)} className="bg-gray-800 hover:bg-gray-700 text-white p-2 rounded shadow border border-gray-600"><RotateCw className="w-4 h-4"/></button>
           <button onClick={handleExport} className="bg-blue-600 hover:bg-blue-500 text-white p-2 rounded shadow flex items-center gap-2 text-sm font-semibold pr-4"><Download className="w-4 h-4"/> Export</button>
        </div>
        {!showSettings && <button onClick={() => setShowSettings(true)} className="absolute top-4 left-4 bg-gray-800 p-2 rounded text-white z-10"><Settings className="w-4 h-4"/></button>}
        {showSettings && <button onClick={() => setShowSettings(false)} className="absolute top-4 left-[340px] bg-gray-800 p-2 rounded-r text-gray-400 z-10 border-y border-r border-gray-700"><X className="w-3 h-3"/></button>}
        
        <canvas ref={canvasRef} width={1600} height={1200} className="w-full h-full cursor-move block"
          onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={() => { setIsDragging(false); setIsPanning(false); }} onMouseLeave={() => { setIsDragging(false); setIsPanning(false); }}
          onWheel={(e) => setView3D(v => ({...v, zoom: Math.max(0.1, v.zoom - e.deltaY * 0.001)}))}
        />
        <div className="absolute bottom-4 left-4 text-gray-500 text-xs pointer-events-none select-none">Left Drag: Rotate • Shift+Drag: Pan • Scroll: Zoom</div>
      </div>
    </div>
  );
};

export default AS1684WallGenerator;
