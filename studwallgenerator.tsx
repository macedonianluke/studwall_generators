import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Download, Plus, Trash2, Settings, Move, ZoomIn, RotateCw, X, Grid, FileText, Sparkles, CheckCircle, AlertTriangle } from 'lucide-react';

// --- AS 1684 CONSTANTS & LOGIC HELPERS ---
const TIMBER_SIZES = {
  '70x35': { d: 70, t: 35, grade: 'MGP10' },
  '90x35': { d: 90, t: 35, grade: 'MGP10' },
  '90x45': { d: 90, t: 45, grade: 'MGP10' },
  '140x45': { d: 140, t: 45, grade: 'MGP12' }
};

const DEFAULT_VIEW = { rotX: 20, rotY: -35, zoom: 0.8, panX: 0, panY: 50 };

const AS1684WallGenerator = () => {
  // --- STATE ---
  const [wallLength, setWallLength] = useState(3600);
  const [wallHeight, setWallHeight] = useState(2400);
  const [studSize, setStudSize] = useState('90x45');
  const [studSpacing, setStudSpacing] = useState(450);
  const [openings, setOpenings] = useState([]);
  const [showBracing, setShowBracing] = useState(true);
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
        const { d: depth, t: thickness } = TIMBER_SIZES[studSize] || TIMBER_SIZES['90x45'];
        const components = [];
        
        // Track vertical members for correct noggin placement
        // format: { x: number (left edge), type: string }
        const verticalMembers = []; 

        const addMember = (type, x, y, z, len, w, d_dim, color, rotation = 0) => {
          components.push({
            id: Math.random().toString(36).substr(2, 9),
            type, x, y, z, len, w, d: d_dim, color, rotation
          });
        };

        // A. PLATES
        // The plates need to extend to the outside face of the end studs.
        // Since studs are centered on the grid lines (0 and wallLength), they extend
        // by thickness/2 on each side.
        const plateStartX = -thickness / 2;
        const fullPlateLength = wallLength + thickness;

        // Bottom Plate Logic
        let currentX = plateStartX;
        const sortedOpenings = [...openings].sort((a, b) => a.startX - b.startX);
        const doorOpenings = sortedOpenings.filter(o => o.sillHeight === 0);
        
        if (doorOpenings.length === 0) {
          addMember('Bottom Plate', plateStartX, 0, 0, fullPlateLength, thickness, depth, '#8B5A2B');
        } else {
          let plateX = plateStartX;
          doorOpenings.forEach(door => {
            const doorStartX = door.startX - thickness; // Jamb stud left edge
            if (doorStartX > plateX) {
              addMember('Bottom Plate', plateX, 0, 0, doorStartX - plateX, thickness, depth, '#8B5A2B');
            }
            plateX = door.startX + door.width; // Jamb stud right edge
          });
          const finalPlateEnd = wallLength + thickness/2;
          if (plateX < finalPlateEnd) {
            addMember('Bottom Plate', plateX, 0, 0, finalPlateEnd - plateX, thickness, depth, '#8B5A2B');
          }
        }

        // Top Plates (continuous)
        addMember('Top Plate (Lower)', plateStartX, wallHeight - (thickness * 2), 0, fullPlateLength, thickness, depth, '#A0522D');
        addMember('Top Plate (Upper)', plateStartX, wallHeight - thickness, 0, fullPlateLength, thickness, depth, '#A0522D');

        // B. STUDS
        const gridPositions = [];
        const safeSpacing = Math.max(100, studSpacing); 
        for (let x = 0; x <= wallLength; x += safeSpacing) gridPositions.push(x);
        if (gridPositions[gridPositions.length - 1] !== wallLength) gridPositions.push(wallLength);

        gridPositions.forEach(xPos => {
          let startY = thickness;
          let endY = wallHeight - (thickness * 2);
          let isDeleted = false;
          let lowerStud = null;
          let upperStud = null;

          for (const op of openings) {
            const opStart = op.startX;
            const opEnd = op.startX + op.width;
            if (xPos > opStart + 10 && xPos < opEnd - 10) {
              isDeleted = true;
              if (op.sillHeight > 0) {
                lowerStud = { y: thickness, h: op.sillHeight - thickness };
              }
              let lintelDepth = op.width > 1200 ? 190 : 140; 
              const spaceAbove = (wallHeight - (thickness * 2)) - (op.sillHeight + op.height + lintelDepth);
              if (spaceAbove > 20) {
                 upperStud = { y: op.sillHeight + op.height + lintelDepth, h: spaceAbove };
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

        // C. OPENINGS (JAMBS & LINTELS)
        openings.forEach(op => {
          const { startX, width, height, sillHeight } = op;
          let lintelDepth = width > 1200 ? 190 : 140;
          const headHeight = sillHeight + height;
          
          // Left Jamb
          const leftJambX = startX - thickness;
          addMember('Jamb Stud', leftJambX, thickness, 0, thickness, headHeight + lintelDepth - thickness, depth, '#CD853F');
          verticalMembers.push({ x: leftJambX, type: 'jamb' });

          // Right Jamb
          const rightJambX = startX + width;
          addMember('Jamb Stud', rightJambX, thickness, 0, thickness, headHeight + lintelDepth - thickness, depth, '#CD853F');
          verticalMembers.push({ x: rightJambX, type: 'jamb' });

          addMember('Lintel', startX - thickness, headHeight, 0, width + (thickness * 2), lintelDepth, depth, '#8B4513');
          if (sillHeight > 0) addMember('Sill Trimmer', startX, sillHeight, 0, width, thickness, depth, '#A0522D');
        });

        // D. NOGGINS (SMART PLACEMENT)
        // 1. Sort all vertical members by X position
        verticalMembers.sort((a, b) => a.x - b.x);
        
        // 2. Remove duplicates (rare, but possible if grid aligns perfectly with jamb)
        const uniqueVerticals = verticalMembers.filter((v, i, a) => i === 0 || Math.abs(v.x - a[i-1].x) > 1);

        const nogginCenter = wallHeight / 2;

        for (let i = 0; i < uniqueVerticals.length - 1; i++) {
            const v1 = uniqueVerticals[i];
            const v2 = uniqueVerticals[i+1];
            
            // Calculate gap between right edge of v1 and left edge of v2
            const gapStart = v1.x + thickness;
            const gapEnd = v2.x;
            const gapWidth = gapEnd - gapStart;

            if (gapWidth < 10) continue; // Skip tiny gaps

            // Check if this gap is INSIDE an opening
            const midX = (gapStart + gapEnd) / 2;
            let insideOpening = false;
            
            for (const op of openings) {
                // Buffer of 10mm to avoid edge cases
                if (midX > op.startX && midX < op.startX + op.width) {
                    // Check if noggin height conflicts with opening
                    const opTop = op.sillHeight + op.height;
                    const opBottom = op.sillHeight;
                    // Standard noggins at mid-height. If opening covers mid-height, we skip.
                    if (nogginCenter > opBottom && nogginCenter < opTop) {
                        insideOpening = true;
                        break;
                    }
                }
            }

            if (!insideOpening) {
                // Stagger logic based on index
                const yPos = (i % 2 === 0) ? nogginCenter + 25 : nogginCenter - 25;
                addMember('Noggin', gapStart, yPos, 0, gapWidth, thickness, depth, '#BC8F8F');
            }
        }

        // E. BRACING
        if (showBracing) {
           const solidPanels = [];
           let currentStart = 0;
           const allOps = [...openings].sort((a,b) => a.startX - b.startX);
           
           allOps.forEach(op => {
               if (op.startX > currentStart) solidPanels.push({ start: currentStart, end: op.startX });
               currentStart = op.startX + op.width;
           });
           
           if (currentStart < wallLength) solidPanels.push({ start: currentStart, end: wallLength });

           solidPanels.forEach(panel => {
               const panelWidth = panel.end - panel.start;
               if (panelWidth > 1200) {
                   const padding = 100;
                   const braceRun = panelWidth - (padding * 2);
                   const braceRise = wallHeight - 200; 
                   const braceLen = Math.sqrt(Math.pow(braceRun, 2) + Math.pow(braceRise, 2));
                   const angleRad = Math.atan2(braceRise, braceRun);
                   const angleDeg = angleRad * (180 / Math.PI);
                   
                   addMember('Metal Brace', panel.start + padding, 100, depth, braceLen, 40, 2, '#708090', angleDeg);
               }
           });
        }

        return components;
    } catch (err) {
        console.error("Frame generation error:", err);
        return [];
    }
  }, [wallLength, wallHeight, studSize, studSpacing, openings, showBracing]);

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

    const { d: studDepth } = TIMBER_SIZES[studSize] || TIMBER_SIZES['90x45'];
    const cx = wallLength / 2;
    const cy = wallHeight / 2;
    const cz = studDepth / 2;
    const scale = Math.min(width / (wallLength * 1.4), height / (wallHeight * 1.4)) * view3D.zoom;
    
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

    const rotatePoint = (px, py, angleDeg) => {
        if (!angleDeg) return { x: px, y: py };
        const rad = angleDeg * (Math.PI / 180);
        return {
            x: px * Math.cos(rad) - py * Math.sin(rad),
            y: px * Math.sin(rad) + py * Math.cos(rad)
        };
    };

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
      const v = [
        [m.x, m.y, m.z], [m.x+m.len, m.y, m.z], [m.x+m.len, m.y+m.w, m.z], [m.x, m.y+m.w, m.z],
        [m.x, m.y, m.z+m.d], [m.x+m.len, m.y, m.z+m.d], [m.x+m.len, m.y+m.w, m.z+m.d], [m.x, m.y+m.w, m.z+m.d]
      ];
      v.forEach(vt => obj += `v ${vt[0]} ${vt[1]} ${vt[2]}\n`);
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
                  <div><label className="text-xs text-gray-400">Length</label><input type="number" value={wallLength} onChange={e => setWallLength(Number(e.target.value))} className="w-full bg-gray-800 border border-gray-700 rounded p-1.5 text-sm" /></div>
                  <div><label className="text-xs text-gray-400">Height</label><input type="number" value={wallHeight} onChange={e => setWallHeight(Number(e.target.value))} className="w-full bg-gray-800 border border-gray-700 rounded p-1.5 text-sm" /></div>
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
                        <div><label className="text-[10px]">Start X</label><input type="number" value={op.startX} onChange={e => { const n = [...openings]; n[idx].startX = Number(e.target.value); setOpenings(n); }} className="w-full bg-gray-900 border border-gray-700 rounded px-1" /></div>
                        <div><label className="text-[10px]">Width</label><input type="number" value={op.width} onChange={e => { const n = [...openings]; n[idx].width = Number(e.target.value); setOpenings(n); }} className="w-full bg-gray-900 border border-gray-700 rounded px-1" /></div>
                        <div><label className="text-[10px]">Height</label><input type="number" value={op.height} onChange={e => { const n = [...openings]; n[idx].height = Number(e.target.value); setOpenings(n); }} className="w-full bg-gray-900 border border-gray-700 rounded px-1" /></div>
                        <div><label className="text-[10px]">Sill</label><input type="number" value={op.sillHeight} onChange={e => { const n = [...openings]; n[idx].sillHeight = Number(e.target.value); setOpenings(n); }} className="w-full bg-gray-900 border border-gray-700 rounded px-1" /></div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}

          {activeTab === 'bom' && (
            <div className="space-y-4">
               <h3 className="text-xs font-bold text-gray-500 uppercase flex gap-2"><FileText className="w-4 h-4"/> Bill of Materials</h3>
               <div className="bg-gray-800 rounded border border-gray-700 overflow-hidden text-xs">
                 <table className="w-full text-left">
                   <thead className="bg-gray-900 text-gray-400"><tr><th className="p-2">Item</th><th className="p-2 text-right">Qty</th><th className="p-2 text-right">LM</th></tr></thead>
                   <tbody className="divide-y divide-gray-700">{Object.entries(generateFrame.reduce((acc, item) => { if(!acc[item.type]) acc[item.type]={c:0,l:0}; acc[item.type].c++; acc[item.type].l+=item.len; return acc; }, {})).map(([k,v])=>(<tr key={k}><td className="p-2">{k}</td><td className="p-2 text-right">{v.c}</td><td className="p-2 text-right">{(v.l/1000).toFixed(1)}m</td></tr>))}</tbody>
                 </table>
               </div>
               <button onClick={handleAIComplianceCheck} disabled={isAiLoading} className="w-full bg-gray-800 p-2 rounded text-sm flex justify-center gap-2 border border-gray-700">{isAiLoading?'Checking...':<><CheckCircle className="w-4 h-4 text-green-500"/> Check Compliance</>}</button>
               {aiAnalysis && <div className="bg-blue-900/30 p-2 rounded text-xs text-blue-200 whitespace-pre-wrap">{aiAnalysis}</div>}
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
