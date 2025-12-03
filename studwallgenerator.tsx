import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Download, Plus, Trash2, Settings, Move, ZoomIn, RotateCw, X, Grid, FileText, Sparkles, CheckCircle, AlertTriangle, Layers, ShoppingCart, Home, Copy, LayoutTemplate, Box } from 'lucide-react';

// --- CONSTANTS ---
const TIMBER_SIZES = {
  '70x35': { d: 70, t: 35, grade: 'MGP10' },
  '90x35': { d: 90, t: 35, grade: 'MGP10' },
  '90x45': { d: 90, t: 45, grade: 'MGP10' },
  '140x45': { d: 140, t: 45, grade: 'MGP12' }
};

const COMMON_ORDER_LENGTHS = [2400, 2700, 3000, 3600, 4200, 4800, 5400, 6000];
const DEFAULT_VIEW = { rotX: 20, rotY: -40, zoom: 0.7, panX: 0, panY: 50 };

// --- GEOMETRY HELPERS ---
const rotatePoint = (px, py, angleDeg) => {
  if (!angleDeg) return { x: px, y: py };
  const rad = angleDeg * (Math.PI / 180);
  return {
      x: px * Math.cos(rad) - py * Math.sin(rad),
      y: px * Math.sin(rad) + py * Math.cos(rad)
  };
};

const adjustColor = (hex, amount) => {
    return '#' + hex.replace(/^#/, '').replace(/../g, color => ('0' + Math.min(255, Math.max(0, parseInt(color, 16) + amount)).toString(16)).substr(-2));
};

// --- CORE ALGORITHM: GENERATE SINGLE WALL ---
const generateSingleWallFrame = (wall) => {
    try {
        const { length, height, studSize, studSpacing, openings, showBracing } = wall;
        
        // Sanitization
        const numLen = parseFloat(length) || 1000;
        const numHeight = parseFloat(height) || 2400;
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
            } else if (type.includes('Plate') || type.includes('Noggin') || type.includes('Sill')) {
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
                type, x, y, z, len, w, d: d_dim, color, rotation,
                cutLength: Math.round(cutLength),
                sectionSize
            });
        };

        // REAL WORLD SITE COLORS
        const COL_PLATE = '#5D4037'; // Dark Hardwood/Treated color
        const COL_STUD = '#E3C08D';  // Pine Yellow
        const COL_NOGGIN = '#DFA6A6'; // Pinkish Primer (Common in AU)
        const COL_LINTEL = '#8D6E63'; // Laminated Beam color
        const COL_BRACE = '#607D8B';  // Metal Grey

        // --- PLATES ---
        const plateStartX = -thickness / 2;
        const fullPlateLength = numLen + thickness;

        // Bottom Plate
        let plateX = plateStartX;
        const sortedOpenings = [...openings].sort((a, b) => (parseFloat(a.startX)||0) - (parseFloat(b.startX)||0));
        const doorOpenings = sortedOpenings.filter(o => (parseFloat(o.sillHeight)||0) === 0);
        
        if (doorOpenings.length === 0) {
            addMember('Bottom Plate', plateStartX, 0, 0, fullPlateLength, thickness, depth, COL_PLATE);
        } else {
            doorOpenings.forEach(door => {
                const dStart = parseFloat(door.startX) || 0;
                const dWidth = parseFloat(door.width) || 0;
                if (dStart > plateX) {
                    addMember('Bottom Plate', plateX, 0, 0, dStart - plateX, thickness, depth, COL_PLATE);
                }
                plateX = dStart + dWidth;
            });
            const finalPlateEnd = numLen + thickness/2;
            if (plateX < finalPlateEnd) {
                addMember('Bottom Plate', plateX, 0, 0, finalPlateEnd - plateX, thickness, depth, COL_PLATE);
            }
        }

        // Top Plates
        addMember('Top Plate (Lower)', plateStartX, numHeight - (thickness * 2), 0, fullPlateLength, thickness, depth, COL_PLATE);
        addMember('Top Plate (Upper)', plateStartX, numHeight - thickness, 0, fullPlateLength, thickness, depth, COL_PLATE);

        // --- STUDS ---
        const gridPositions = [];
        const safeSpacing = Math.max(100, numSpacing); 
        for (let x = 0; x <= numLen; x += safeSpacing) gridPositions.push(x);
        if (gridPositions[gridPositions.length - 1] !== numLen) gridPositions.push(numLen);

        gridPositions.forEach(xPos => {
            let startY = thickness;
            let endY = numHeight - (thickness * 2);
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
                    if (opSill > 0) lowerStud = { y: thickness, h: opSill - thickness };
                    let lintelDepth = opWidth > 1200 ? 190 : 140; 
                    const spaceAbove = (numHeight - (thickness * 2)) - (opSill + opHeight + lintelDepth);
                    if (spaceAbove > 20) upperStud = { y: opSill + opHeight + lintelDepth, h: spaceAbove };
                    break;
                }
            }

            const studX = xPos - (thickness/2);
            if (!isDeleted) {
                addMember('Common Stud', studX, startY, 0, thickness, endY - startY, depth, COL_STUD);
                verticalMembers.push({ x: studX });
            } else {
                if (lowerStud) addMember('Jack Stud', studX, lowerStud.y, 0, thickness, lowerStud.h, depth, COL_STUD);
                if (upperStud) addMember('Cripple Stud', studX, upperStud.y, 0, thickness, upperStud.h, depth, COL_STUD);
            }
        });

        // --- OPENINGS ---
        openings.forEach(op => {
            const opStart = parseFloat(op.startX) || 0;
            const opWidth = parseFloat(op.width) || 0;
            const opHeight = parseFloat(op.height) || 0;
            const opSill = parseFloat(op.sillHeight) || 0;
            const headHeight = opSill + opHeight;
            let lintelDepth = opWidth > 1200 ? 190 : 140;

            const leftJambX = opStart - thickness;
            addMember('Jamb Stud', leftJambX, thickness, 0, thickness, headHeight + lintelDepth - thickness, depth, COL_STUD);
            verticalMembers.push({ x: leftJambX });

            const rightJambX = opStart + opWidth;
            addMember('Jamb Stud', rightJambX, thickness, 0, thickness, headHeight + lintelDepth - thickness, depth, COL_STUD);
            verticalMembers.push({ x: rightJambX });

            addMember('Lintel', opStart - thickness, headHeight, 0, opWidth + (thickness * 2), lintelDepth, depth, COL_LINTEL);
            if (opSill > 0) addMember('Sill Trimmer', opStart, opSill, 0, opWidth, thickness, depth, COL_PLATE);
        });

        // --- NOGGINS (With Physical Gaps) ---
        verticalMembers.sort((a, b) => a.x - b.x);
        const uniqueVerticals = verticalMembers.filter((v, i, a) => i === 0 || Math.abs(v.x - a[i-1].x) > 1);
        const nogginCenter = numHeight / 2;

        for (let i = 0; i < uniqueVerticals.length - 1; i++) {
            const v1 = uniqueVerticals[i];
            const v2 = uniqueVerticals[i+1];
            
            // VISUAL TRICK: Shorten noggin by 1mm total (0.5mm each side) 
            // This creates a physical gap for the renderer to draw a clean edge line
            const gapStart = v1.x + thickness + 0.5;
            const gapWidth = (v2.x - gapStart) - 0.5;

            if (gapWidth < 10) continue; 

            const midX = gapStart + (gapWidth / 2);
            let insideOpening = false;
            for (const op of openings) {
                const s = parseFloat(op.startX);
                const w = parseFloat(op.width);
                const sill = parseFloat(op.sillHeight);
                const h = parseFloat(op.height);
                if (midX > s && midX < s + w) {
                    if (nogginCenter > sill && nogginCenter < sill + h) {
                        insideOpening = true;
                        break;
                    }
                }
            }

            if (!insideOpening) {
                const yPos = (i % 2 === 0) ? nogginCenter + 25 : nogginCenter - 25;
                addMember('Noggin', gapStart, yPos, 0, gapWidth, thickness, depth, COL_NOGGIN);
            }
        }

        // --- BRACING (Offset from Face) ---
        if (showBracing) {
           const solidPanels = [];
           let currentStart = 0;
           const allOps = [...openings].sort((a,b) => (parseFloat(a.startX)||0) - (parseFloat(b.startX)||0));
           
           allOps.forEach(op => {
               const opStart = parseFloat(op.startX);
               const opWidth = parseFloat(op.width);
               if (opStart > currentStart) solidPanels.push({ start: currentStart, end: opStart });
               currentStart = Math.max(currentStart, opStart + opWidth);
           });
           if (currentStart < numLen) solidPanels.push({ start: currentStart, end: numLen });

           solidPanels.forEach(panel => {
               const panelWidth = panel.end - panel.start;
               if (panelWidth > 1200) {
                   const padding = 150;
                   const braceRun = panelWidth - (padding * 2);
                   if (braceRun > 500) {
                      const braceRise = numHeight - 200; 
                      const braceLen = Math.sqrt(Math.pow(braceRun, 2) + Math.pow(braceRise, 2));
                      const angleRad = Math.atan2(braceRise, braceRun);
                      const angleDeg = angleRad * (180 / Math.PI);
                      
                      // VISUAL TRICK: Z = depth + 2
                      // Puts the brace 2mm off the face of the studs so it draws cleanly on top
                      addMember('Metal Brace', panel.start + padding, 100, depth + 2, braceLen, 40, 2, COL_BRACE, angleDeg);
                   }
               }
           });
        }

        return components;
    } catch (e) {
        console.error("Single Wall Gen Error", e);
        return [];
    }
};


const AS1684WallGenerator = () => {
  // --- MULTI-WALL STATE ---
  const [walls, setWalls] = useState([
    { id: 1, name: 'Wall 1', length: 3000, height: 2400, studSize: '90x45', studSpacing: 450, openings: [], position: { x: 0, y: 0, rotation: 0 }, showBracing: true }
  ]);
  const [selectedWallId, setSelectedWallId] = useState(1);
  const [includeWaste, setIncludeWaste] = useState(true);
  const [view3D, setView3D] = useState(DEFAULT_VIEW);
  const [projectionMode, setProjectionMode] = useState('perspective'); 
  const [activeTab, setActiveTab] = useState('walls'); 
  const [showSettings, setShowSettings] = useState(true);

  // Mouse / Canvas state
  const [isDragging, setIsDragging] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const canvasRef = useRef(null);

  // Helper to get active wall
  const activeWall = walls.find(w => w.id === selectedWallId) || walls[0];

  // Helper to update active wall
  const updateActiveWall = (field, value) => {
    setWalls(prev => prev.map(w => w.id === selectedWallId ? { ...w, [field]: value } : w));
  };

  const updateActivePosition = (field, value) => {
    setWalls(prev => prev.map(w => w.id === selectedWallId ? { ...w, position: { ...w.position, [field]: parseFloat(value) || 0 } } : w));
  };

  const addWall = () => {
    const newId = Date.now();
    const lastWall = walls[walls.length-1];
    const newPos = lastWall ? { x: lastWall.position.x + 1000, y: lastWall.position.y, rotation: 0 } : { x:0, y:0, rotation:0 };
    
    setWalls([...walls, { 
      id: newId, 
      name: `Wall ${walls.length + 1}`, 
      length: 3000, 
      height: 2400, 
      studSize: '90x45', 
      studSpacing: 450, 
      openings: [], 
      position: newPos,
      showBracing: true
    }]);
    setSelectedWallId(newId);
    setActiveTab('editor');
  };

  // --- LAYOUT GENERATORS ---
  const createLayoutL = () => {
      const h = 2400;
      const s = '90x45';
      const sp = 450;
      setWalls([
          { id: 1, name: 'Wall A (Long)', length: 4000, height: h, studSize: s, studSpacing: sp, openings: [], position: { x: 0, y: 0, rotation: 0 }, showBracing: true },
          { id: 2, name: 'Wall B (Short)', length: 3000, height: h, studSize: s, studSpacing: sp, openings: [], position: { x: 4000, y: 0, rotation: 90 }, showBracing: true }
      ]);
      setSelectedWallId(1);
  };

  const createLayoutU = () => {
      const h = 2400;
      const s = '90x45';
      const sp = 450;
      setWalls([
          { id: 1, name: 'Wall A (Left)', length: 3000, height: h, studSize: s, studSpacing: sp, openings: [], position: { x: 0, y: 0, rotation: 90 }, showBracing: true },
          { id: 2, name: 'Wall B (Back)', length: 4000, height: h, studSize: s, studSpacing: sp, openings: [{id: 11, startX: 1500, width: 900, height: 2100, sillHeight: 0}], position: { x: 0, y: 0, rotation: 0 }, showBracing: true },
          { id: 3, name: 'Wall C (Right)', length: 3000, height: h, studSize: s, studSpacing: sp, openings: [], position: { x: 4000, y: 0, rotation: 90 }, showBracing: true }
      ]);
      setSelectedWallId(2);
  };

  // --- HOUSE GENERATION ---
  const houseGeometry = useMemo(() => {
    let allComponents = [];
    
    walls.forEach(wall => {
      const localParts = generateSingleWallFrame(wall);
      const { x: wx, y: wy, rotation: wRot } = wall.position;
      
      const transformed = localParts.map(part => {
        return {
          ...part,
          wallId: wall.id,
          worldTransform: { x: wx, z: wy, rotation: wRot }
        };
      });
      allComponents = [...allComponents, ...transformed];
    });
    return allComponents;
  }, [walls]);

  // --- GLOBAL BOM ENGINE ---
  const globalBOM = useMemo(() => {
    const rawGroups = {};
    
    houseGeometry.forEach(item => {
      const sizeKey = item.sectionSize || "Misc";
      if (!rawGroups[sizeKey]) rawGroups[sizeKey] = { pieces: [], cutList: {}, totalLM: 0 };
      
      rawGroups[sizeKey].pieces.push(item.cutLength);
      
      const itemKey = `${item.type} @ ${item.cutLength}mm`;
      if (!rawGroups[sizeKey].cutList[itemKey]) {
        rawGroups[sizeKey].cutList[itemKey] = { type: item.type, len: item.cutLength, count: 0 };
      }
      rawGroups[sizeKey].cutList[itemKey].count++;
      rawGroups[sizeKey].totalLM += item.cutLength;
    });

    Object.keys(rawGroups).forEach(sizeKey => {
      if (sizeKey === 'Metal Strap' || sizeKey === 'Misc') return;
      const pieces = [...rawGroups[sizeKey].pieces].sort((a, b) => b - a);
      const bins = [];

      pieces.forEach(piece => {
        let fitted = false;
        for (let bin of bins) {
          if (bin.remaining >= piece + 5) {
            bin.remaining -= (piece + 5);
            bin.cuts.push(piece);
            fitted = true;
            break;
          }
        }
        if (!fitted) {
          const bestStock = COMMON_ORDER_LENGTHS.find(l => l >= piece);
          if (bestStock) {
            bins.push({ length: bestStock, remaining: bestStock - piece - 5, cuts: [piece] });
          } else {
            bins.push({ length: Math.ceil(piece / 600) * 600, remaining: 0, cuts: [piece] });
          }
        }
      });

      const orderSummary = {};
      bins.forEach(bin => {
        if (!orderSummary[bin.length]) orderSummary[bin.length] = 0;
        orderSummary[bin.length]++;
      });
      rawGroups[sizeKey].orderList = orderSummary;
    });
    
    return rawGroups;
  }, [houseGeometry]);

  // --- RENDER LOOP ---
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    ctx.fillStyle = '#111827'; // Gray 900
    ctx.fillRect(0, 0, width, height);
    
    if (houseGeometry.length === 0) return;

    const scale = view3D.zoom;
    
    const project = (x, y, z) => {
      let dx = x;
      let dy = y; 
      let dz = z;

      const radY = view3D.rotY * (Math.PI / 180);
      const radX = view3D.rotX * (Math.PI / 180);

      let x1 = dx * Math.cos(radY) - dz * Math.sin(radY);
      let z1 = dx * Math.sin(radY) + dz * Math.cos(radY);

      let y2 = dy * Math.cos(radX) - z1 * Math.sin(radX);
      let z2 = dy * Math.sin(radX) + z1 * Math.cos(radX);

      const dist = 4000 + z2; 
      
      let f;
      if (projectionMode === 'orthographic') {
          f = 1; // Constant scale for Ortho
      } else {
          f = 4000 / (dist < 100 ? 100 : dist); // Perspective divide by Z
      }
      
      return {
        x: (width / 2) + (x1 * f) * scale + view3D.panX,
        y: (height / 2) - (y2 * f) * scale + view3D.panY,
        z: z2 
      };
    };

    let allFaces = [];

    houseGeometry.forEach(comp => {
      const { x, y, z, len, w, d, color, rotation, worldTransform, wallId } = comp;
      const isSelected = wallId === selectedWallId;
      const baseColor = isSelected ? color : adjustColor(color, -60); // Dim inactive walls more

      const rawVerts = [
        {x: 0, y: 0, z: 0}, {x: len, y: 0, z: 0}, {x: len, y: w, z: 0}, {x: 0, y: w, z: 0},
        {x: 0, y: 0, z: d}, {x: len, y: 0, z: d}, {x: len, y: w, z: d}, {x: 0, y: w, z: d}
      ];

      const worldVerts = rawVerts.map(v => {
          const localRot = rotatePoint(v.x, v.y, rotation);
          const lx = x + localRot.x;
          const ly = y + localRot.y;
          const lz = z + v.z;

          const wRad = (worldTransform.rotation || 0) * (Math.PI / 180);
          const wx_rot = lx * Math.cos(wRad) - lz * Math.sin(wRad);
          const wz_rot = lx * Math.sin(wRad) + lz * Math.cos(wRad);

          return { x: wx_rot + worldTransform.x, y: ly, z: wz_rot + worldTransform.z };
      });

      const p = worldVerts.map(pt => project(pt.x, pt.y, pt.z));

      // Shading: Top is bright, sides are darker
      const faces = [
        { v: [0, 1, 2, 3], c: baseColor }, // Front
        { v: [5, 4, 7, 6], c: adjustColor(baseColor, -40) }, // Back
        { v: [4, 0, 3, 7], c: adjustColor(baseColor, -20) }, // Left
        { v: [1, 5, 6, 2], c: adjustColor(baseColor, -20) }, // Right
        { v: [3, 2, 6, 7], c: adjustColor(baseColor, 30) }, // Top (Brightest)
        { v: [4, 5, 1, 0], c: adjustColor(baseColor, -50) } // Bottom
      ];

      faces.forEach(face => {
        // Use Average Z depth for sorting (Painter's Algorithm Standard)
        const zDepth = (p[face.v[0]].z + p[face.v[1]].z + p[face.v[2]].z + p[face.v[3]].z) / 4;
        allFaces.push({ pts: face.v.map(i => p[i]), z: zDepth, color: face.c });
      });
    });

    // Sort Back-to-Front (Large Z = Far, Small Z = Near)
    // We draw Far objects first. So Descending Z.
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
      
      // CRISP SOLID BLACK LINES
      ctx.strokeStyle = '#000000'; 
      ctx.lineWidth = 0.8;
      ctx.stroke();
    });

  }, [houseGeometry, view3D, selectedWallId, projectionMode]);

  // --- EXPORT ---
  const handleExport = () => {
    let obj = `# AS 1684 House Export\n`;
    let vc = 1;
    
    houseGeometry.forEach((comp, i) => {
      obj += `o ${comp.type.replace(/\s/g, '_')}_${comp.wallId}_${i}\n`;
      
      const { x, y, z, len, w, d, rotation, worldTransform } = comp;
      
      const rawVerts = [
        {x: 0, y: 0, z: 0}, {x: len, y: 0, z: 0}, {x: len, y: w, z: 0}, {x: 0, y: w, z: 0},
        {x: 0, y: 0, z: d}, {x: len, y: 0, z: d}, {x: len, y: w, z: d}, {x: 0, y: w, z: d}
      ];

      const worldVerts = rawVerts.map(v => {
          const localRot = rotatePoint(v.x, v.y, rotation);
          const lx = x + localRot.x;
          const ly = y + localRot.y;
          const lz = z + v.z;

          const wRad = (worldTransform.rotation || 0) * (Math.PI / 180);
          const wx_rot = lx * Math.cos(wRad) - lz * Math.sin(wRad);
          const wz_rot = lx * Math.sin(wRad) + lz * Math.cos(wRad);

          return { x: wx_rot + worldTransform.x, y: ly, z: wz_rot + worldTransform.z };
      });

      worldVerts.forEach(vt => obj += `v ${vt.x.toFixed(2)} ${vt.y.toFixed(2)} ${vt.z.toFixed(2)}\n`);
      
      const f = [[1,2,3,4],[5,8,7,6],[1,5,6,2],[2,6,7,3],[3,7,8,4],[5,1,4,8]];
      f.forEach(fa => obj += `f ${fa[0]+vc-1} ${fa[1]+vc-1} ${fa[2]+vc-1} ${fa[3]+vc-1}\n`);
      vc += 8;
    });

    const blob = new Blob([obj], {type: 'text/plain'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'house_frame.obj';
    a.click();
  };

  // --- HANDLERS ---
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
        <div className="p-4 border-b border-gray-800 flex justify-between items-center bg-gray-900">
          <h1 className="font-bold flex items-center gap-2"><Home className="w-5 h-5 text-blue-500" /> House Builder</h1>
          <div className="flex gap-1 bg-gray-800 rounded p-1">
             <button onClick={() => setActiveTab('walls')} className={`px-2 py-1 text-xs rounded ${activeTab==='walls'?'bg-blue-600':'hover:bg-gray-700'}`}>Walls</button>
             <button onClick={() => setActiveTab('editor')} className={`px-2 py-1 text-xs rounded ${activeTab==='editor'?'bg-blue-600':'hover:bg-gray-700'}`}>Edit</button>
             <button onClick={() => setActiveTab('bom')} className={`px-2 py-1 text-xs rounded ${activeTab==='bom'?'bg-blue-600':'hover:bg-gray-700'}`}>BOM</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          
          {/* --- TAB: WALL LIST --- */}
          {activeTab === 'walls' && (
            <div className="space-y-4">
               
               <div className="bg-gray-800 rounded p-3 border border-gray-700">
                  <h3 className="text-xs font-bold text-gray-400 uppercase mb-2 flex items-center gap-1"><LayoutTemplate className="w-3 h-3"/> Quick Layouts</h3>
                  <div className="grid grid-cols-2 gap-2">
                     <button onClick={createLayoutL} className="bg-gray-700 hover:bg-gray-600 p-2 rounded text-xs text-center border border-gray-600 transition">L-Shape Corner</button>
                     <button onClick={createLayoutU} className="bg-gray-700 hover:bg-gray-600 p-2 rounded text-xs text-center border border-gray-600 transition">U-Shape Room</button>
                  </div>
               </div>

               <div className="flex justify-between items-center pt-2 border-t border-gray-800">
                 <h3 className="text-xs font-bold text-gray-500 uppercase">Custom Walls</h3>
                 <button onClick={addWall} className="flex items-center gap-1 text-xs bg-blue-700 px-2 py-1 rounded hover:bg-blue-600"><Plus className="w-3 h-3"/> Add Wall</button>
               </div>
               <div className="space-y-2">
                 {walls.map(w => (
                   <div key={w.id} 
                        onClick={() => { setSelectedWallId(w.id); setActiveTab('editor'); }}
                        className={`p-3 rounded border cursor-pointer transition-all flex justify-between items-center ${selectedWallId === w.id ? 'bg-blue-900/40 border-blue-500 ring-1 ring-blue-500' : 'bg-gray-800 border-gray-700 hover:bg-gray-750'}`}>
                      <div>
                        <div className="font-semibold text-sm text-gray-200">{w.name}</div>
                        <div className="text-[10px] text-gray-400">{w.length}mm x {w.height}mm</div>
                      </div>
                      <div className="text-xs text-gray-500 font-mono bg-gray-900 px-1.5 py-0.5 rounded">
                        {w.position.rotation}°
                      </div>
                   </div>
                 ))}
               </div>
            </div>
          )}

          {/* --- TAB: EDITOR (Active Wall) --- */}
          {activeTab === 'editor' && (
            <>
              <div className="flex justify-between items-center mb-2">
                 <input className="bg-transparent font-bold border-b border-gray-700 focus:border-blue-500 outline-none w-32 text-gray-200" value={activeWall.name} onChange={e => updateActiveWall('name', e.target.value)} />
                 <button onClick={() => { 
                    if(walls.length > 1) {
                        const newWalls = walls.filter(w => w.id !== selectedWallId);
                        setWalls(newWalls);
                        setSelectedWallId(newWalls[0].id);
                    }
                 }} className="text-red-400 hover:text-red-300"><Trash2 className="w-4 h-4"/></button>
              </div>

              <section className="space-y-3 pt-2 border-t border-gray-800">
                <h3 className="text-xs font-bold text-blue-400 uppercase">Floor Position</h3>
                <div className="grid grid-cols-3 gap-2">
                  <div><label className="text-[10px] text-gray-400">X (mm)</label><input type="text" value={activeWall.position.x} onChange={e => updateActivePosition('x', e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded px-1 text-sm text-gray-200"/></div>
                  <div><label className="text-[10px] text-gray-400">Y (mm)</label><input type="text" value={activeWall.position.y} onChange={e => updateActivePosition('y', e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded px-1 text-sm text-gray-200"/></div>
                  <div><label className="text-[10px] text-gray-400">Angle</label><input type="text" value={activeWall.position.rotation} onChange={e => updateActivePosition('rotation', e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded px-1 text-sm text-gray-200"/></div>
                </div>
              </section>

              <section className="space-y-3 pt-2 border-t border-gray-800">
                <h3 className="text-xs font-bold text-gray-500 uppercase">Dimensions</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="text-xs text-gray-400">Length</label><input type="text" value={activeWall.length} onChange={e => updateActiveWall('length', e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded p-1.5 text-sm text-gray-200" /></div>
                  <div><label className="text-xs text-gray-400">Height</label><input type="text" value={activeWall.height} onChange={e => updateActiveWall('height', e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded p-1.5 text-sm text-gray-200" /></div>
                </div>
              </section>

              <section className="space-y-3">
                <h3 className="text-xs font-bold text-gray-500 uppercase">Structure</h3>
                <div className="space-y-2">
                  <select value={activeWall.studSize} onChange={e => updateActiveWall('studSize', e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded p-1.5 text-sm text-gray-200">{Object.keys(TIMBER_SIZES).map(s => <option key={s} value={s}>{s}</option>)}</select>
                  <select value={activeWall.studSpacing} onChange={e => updateActiveWall('studSpacing', e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded p-1.5 text-sm text-gray-200"><option value={450}>450mm</option><option value={600}>600mm</option></select>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={activeWall.showBracing} onChange={e => updateActiveWall('showBracing', e.target.checked)} /> <span className="text-sm text-gray-300">Bracing</span></label>
                </div>
              </section>

              <section className="space-y-3">
                <div className="flex justify-between"><h3 className="text-xs font-bold text-gray-500 uppercase">Openings</h3><button onClick={() => updateActiveWall('openings', [...activeWall.openings, { id: Date.now(), startX: 500, width: 900, height: 2100, sillHeight: 0 }])} className="text-blue-400"><Plus className="w-4 h-4"/></button></div>
                <div className="space-y-2">
                  {activeWall.openings.map((op, idx) => (
                    <div key={op.id} className="bg-gray-800 p-2 rounded border border-gray-700 text-sm space-y-2">
                      <div className="flex justify-between text-xs text-gray-400"><span>#{idx+1}</span><button onClick={() => updateActiveWall('openings', activeWall.openings.filter(o => o.id !== op.id))} className="text-red-400"><Trash2 className="w-3 h-3"/></button></div>
                      <div className="grid grid-cols-2 gap-2">
                        <div><label className="text-[10px]">Start X</label><input type="text" value={op.startX} onChange={e => { const n = [...activeWall.openings]; n[idx].startX = e.target.value; updateActiveWall('openings', n); }} className="w-full bg-gray-900 border border-gray-700 rounded px-1 text-gray-200" /></div>
                        <div><label className="text-[10px]">Width</label><input type="text" value={op.width} onChange={e => { const n = [...activeWall.openings]; n[idx].width = e.target.value; updateActiveWall('openings', n); }} className="w-full bg-gray-900 border border-gray-700 rounded px-1 text-gray-200" /></div>
                        <div><label className="text-[10px]">Height</label><input type="text" value={op.height} onChange={e => { const n = [...activeWall.openings]; n[idx].height = e.target.value; updateActiveWall('openings', n); }} className="w-full bg-gray-900 border border-gray-700 rounded px-1 text-gray-200" /></div>
                        <div><label className="text-[10px]">Sill</label><input type="text" value={op.sillHeight} onChange={e => { const n = [...activeWall.openings]; n[idx].sillHeight = e.target.value; updateActiveWall('openings', n); }} className="w-full bg-gray-900 border border-gray-700 rounded px-1 text-gray-200" /></div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}

          {/* --- TAB: BOM --- */}
          {activeTab === 'bom' && (
            <div className="space-y-4">
               <div className="flex items-center justify-between">
                 <h3 className="text-xs font-bold text-gray-500 uppercase flex gap-2"><ShoppingCart className="w-4 h-4"/> Global Order</h3>
               </div>
               
               <div className="space-y-4">
                 {Object.keys(globalBOM).sort().map(section => (
                   <div key={section} className="bg-gray-800 rounded border border-gray-700 overflow-hidden text-xs">
                     <div className="bg-gray-900 p-2 font-bold text-blue-400 flex justify-between items-center">
                       <span>{section}</span>
                       <span className="text-gray-500 text-[10px]">
                         {((globalBOM[section].totalLM) / 1000).toFixed(1)}m Total
                       </span>
                     </div>
                     {globalBOM[section].orderList && (
                       <div className="bg-blue-900/20 p-2 border-b border-gray-700">
                         <div className="flex flex-wrap gap-2">
                           {Object.entries(globalBOM[section].orderList).sort((a,b)=>b[0]-a[0]).map(([len, count]) => (
                             <span key={len} className="bg-blue-600 text-white px-2 py-0.5 rounded text-[11px] font-mono">
                               {count}x {len}mm
                             </span>
                           ))}
                         </div>
                       </div>
                     )}
                   </div>
                 ))}
               </div>
            </div>
          )}

        </div>
      </div>

      {/* CANVAS AREA */}
      <div className="flex-1 relative bg-[#12141a]">
        <div className="absolute top-4 right-4 flex gap-2 z-10">
           {/* VIEW TOGGLE */}
           <button onClick={() => setProjectionMode(m => m === 'perspective' ? 'orthographic' : 'perspective')} 
                   className={`p-2 rounded shadow border border-gray-600 text-white transition ${projectionMode === 'orthographic' ? 'bg-blue-600' : 'bg-gray-800 hover:bg-gray-700'}`}
                   title="Toggle Orthographic/Perspective">
              {projectionMode === 'perspective' ? <Box className="w-4 h-4" /> : <Grid className="w-4 h-4" />}
           </button>

           <button onClick={() => setView3D(DEFAULT_VIEW)} className="bg-gray-800 hover:bg-gray-700 text-white p-2 rounded shadow border border-gray-600"><RotateCw className="w-4 h-4"/></button>
           <button onClick={handleExport} className="bg-blue-600 hover:bg-blue-500 text-white p-2 rounded shadow flex items-center gap-2 text-sm font-semibold pr-4"><Download className="w-4 h-4"/> Export House</button>
        </div>
        {!showSettings && <button onClick={() => setShowSettings(true)} className="absolute top-4 left-4 bg-gray-800 p-2 rounded text-white z-10"><Settings className="w-4 h-4"/></button>}
        {showSettings && <button onClick={() => setShowSettings(false)} className="absolute top-4 left-[340px] bg-gray-800 p-2 rounded-r text-gray-400 z-10 border-y border-r border-gray-700"><X className="w-3 h-3"/></button>}
        
        <canvas ref={canvasRef} width={1600} height={1200} className="w-full h-full cursor-move block"
          onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={() => { setIsDragging(false); setIsPanning(false); }} onMouseLeave={() => { setIsDragging(false); setIsPanning(false); }}
          onWheel={(e) => setView3D(v => ({...v, zoom: Math.max(0.1, v.zoom - e.deltaY * 0.001)}))}
        />
        <div className="absolute bottom-4 left-4 text-gray-500 text-xs pointer-events-none select-none">
            Left Drag: Rotate • Shift+Drag: Pan • Use 'Walls' tab to layout
        </div>
      </div>
    </div>
  );
};

export default AS1684WallGenerator;
