import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Download, Plus, Trash2, Settings, Move, ZoomIn, RotateCw, X, Grid, FileText, Sparkles, CheckCircle, AlertTriangle, Layers, ShoppingCart, Home, Copy, LayoutTemplate, Box, PenTool, MousePointer, ZoomOut, Palette, ArrowLeftRight, BrickWall } from 'lucide-react';

// --- CONSTANTS ---
const TIMBER_SIZES = {
  '70x35': { d: 70, t: 35, grade: 'MGP10' },
  '90x35': { d: 90, t: 35, grade: 'MGP10' },
  '90x45': { d: 90, t: 45, grade: 'MGP10' },
  '140x45': { d: 140, t: 45, grade: 'MGP12' }
};

// Default Material Library
const DEFAULT_MATERIALS = [
    { id: 'none', name: 'None', thickness: 0, cavity: 0, color: '#ffffff', opacity: 0.0, type: 'both' },
    { id: 'gyprock_10', name: 'Plasterboard 10mm', thickness: 10, cavity: 0, color: '#E0E0E0', opacity: 0.3, type: 'internal' },
    { id: 'gyprock_13', name: 'Plasterboard 13mm', thickness: 13, cavity: 0, color: '#D0D0D0', opacity: 0.3, type: 'internal' },
    { id: 'villaboard_6', name: 'Villaboard 6mm', thickness: 6, cavity: 0, color: '#B0BEC5', opacity: 0.4, type: 'internal' },
    { id: 'weatherboard', name: 'Weatherboard', thickness: 20, cavity: 0, color: '#F5F5DC', opacity: 0.5, type: 'external' },
    { id: 'brick_veneer', name: 'Brick Veneer 110mm', thickness: 110, cavity: 40, color: '#8B4513', opacity: 0.7, type: 'external' },
    { id: 'fc_cladding', name: 'FC Sheet 9mm', thickness: 9, cavity: 0, color: '#90A4AE', opacity: 0.5, type: 'external' },
    { id: 'hebel_75', name: 'Hebel 75mm', thickness: 75, cavity: 20, color: '#CFD8DC', opacity: 0.6, type: 'external' }
];

const COMMON_ORDER_LENGTHS = [2400, 2700, 3000, 3600, 4200, 4800, 5400, 6000];
const DEFAULT_VIEW = { rotX: 20, rotY: -40, zoom: 0.6, panX: 0, panY: 50 };

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

const dist = (p1, p2) => {
    if(!p1 || !p2) return Infinity;
    return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
}

// --- CORE ALGORITHM: GENERATE SINGLE WALL ---
const generateSingleWallFrame = (wall, materialsList, trimStart = 0, trimEnd = 0, cornerTypeStart = null, cornerTypeEnd = null) => {
    try {
        const { length, height, studSize, studSpacing, openings, showBracing, isFlipped } = wall;
        
        const numLen = parseFloat(length) || 1000;
        const numHeight = parseFloat(height) || 2400;
        const numSpacing = parseFloat(studSpacing) || 450;
        const { d: depth, t: thickness } = TIMBER_SIZES[studSize] || TIMBER_SIZES['90x45'];
        
        const components = [];
        
        const addMember = (type, x, y, z, len, w, d_dim, color, rotation = 0, opacity = 1.0) => {
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
            } else if (type.includes('Lining')) {
                cutLength = 0;
                sectionSize = "Sheet";
            }

            components.push({
                type, x, y, z, len, w, d: d_dim, color, rotation, opacity,
                cutLength: Math.round(cutLength),
                sectionSize
            });
        };

        // COLORS
        const COL_PLATE = '#5D4037'; 
        const COL_STUD = '#E3C08D';  
        const COL_NOGGIN = '#DFA6A6'; 
        const COL_LINTEL = '#8D6E63'; 
        const COL_BRACE = '#607D8B';
        
        // Calculate Effective Frame Length (Physical timber length)
        const frameStart = trimStart; 
        const frameEnd = numLen - trimEnd; 
        const frameLen = frameEnd - frameStart;

        // --- LININGS ---
        if (wall.internalLining && wall.internalLining !== 'none') {
            const mat = materialsList.find(m => m.id === wall.internalLining) || DEFAULT_MATERIALS[1];
            const zPos = !isFlipped ? (0 - (mat.cavity || 0) - mat.thickness) : (depth + (mat.cavity || 0));
            addMember(`Int. ${mat.name}`, 0, 0, zPos, numLen, numHeight, mat.thickness, mat.color, 0, mat.opacity);
        }
        if (wall.externalLining && wall.externalLining !== 'none') {
            const mat = materialsList.find(m => m.id === wall.externalLining) || DEFAULT_MATERIALS[4];
            const zPos = !isFlipped ? (depth + (mat.cavity || 0)) : (0 - (mat.cavity || 0) - mat.thickness);
            addMember(`Ext. ${mat.name}`, 0, 0, zPos, numLen, numHeight, mat.thickness, mat.color, 0, mat.opacity);
        }

        // --- PLATES ---
        // Bottom Plate
        const sortedOpenings = [...openings].sort((a, b) => (parseFloat(a.startX)||0) - (parseFloat(b.startX)||0));
        const doorOpenings = sortedOpenings.filter(o => (parseFloat(o.sillHeight)||0) === 0);
        
        if (doorOpenings.length === 0) {
            addMember('Bottom Plate', frameStart, 0, 0, frameLen, thickness, depth, COL_PLATE);
        } else {
            let currentX = frameStart;
            doorOpenings.forEach(door => {
                const dStart = parseFloat(door.startX);
                const dWidth = parseFloat(door.width);
                if (dStart > currentX) {
                    addMember('Bottom Plate', currentX, 0, 0, dStart - currentX, thickness, depth, COL_PLATE);
                }
                currentX = dStart + dWidth;
            });
            if (currentX < frameEnd) {
                 addMember('Bottom Plate', currentX, 0, 0, frameEnd - currentX, thickness, depth, COL_PLATE);
            }
        }

        // Top Plates (Continuous)
        addMember('Top Plate (Lower)', frameStart, numHeight - (thickness * 2), 0, frameLen, thickness, depth, COL_PLATE);
        addMember('Top Plate (Upper)', frameStart, numHeight - thickness, 0, frameLen, thickness, depth, COL_PLATE);

        // --- CORNER STUDS ---
        if (cornerTypeStart === 'through') {
            addMember('Corner Stud 1', 0, thickness, 0, thickness, numHeight - 3*thickness, depth, COL_STUD);
            addMember('Corner Stud 2', depth + 10, thickness, 0, thickness, numHeight - 3*thickness, depth, COL_STUD);
            addMember('Corner Block', thickness, numHeight/2, 0, depth+10-thickness, thickness, depth, COL_NOGGIN);
        }

        if (cornerTypeEnd === 'through') {
             addMember('Corner Stud 1', numLen - thickness, thickness, 0, thickness, numHeight - 3*thickness, depth, COL_STUD);
             addMember('Corner Stud 2', numLen - depth - 10 - thickness, thickness, 0, thickness, numHeight - 3*thickness, depth, COL_STUD);
             addMember('Corner Block', numLen - depth - 10, numHeight/2, 0, depth+10-thickness, thickness, depth, COL_NOGGIN);
        }

        // --- STUDS ---
        const gridPositions = [];
        gridPositions.push(frameStart);
        let currentX = frameStart + numSpacing;
        while (currentX < frameEnd - thickness) {
            gridPositions.push(currentX);
            currentX += numSpacing;
        }
        gridPositions.push(frameEnd - thickness);

        gridPositions.forEach(xPos => {
            let startY = thickness;
            let endY = numHeight - (thickness * 2);
            let isDeleted = false;
            let lowerStud = null;
            let upperStud = null;

            for (const op of openings) {
                const opStart = parseFloat(op.startX) || 0;
                const opWidth = parseFloat(op.width) || 0;
                const opEnd = opStart + opWidth;
                
                const studCenter = xPos + thickness/2;

                if (studCenter > opStart && studCenter < opEnd) {
                    isDeleted = true;
                    const opSill = parseFloat(op.sillHeight) || 0;
                    const opHeight = parseFloat(op.height) || 0;
                    const lintelDepth = opWidth > 1200 ? 190 : 140;
                    
                    if (opSill > 0) lowerStud = { y: thickness, h: opSill - thickness };
                    const spaceAbove = (numHeight - (thickness * 2)) - (opSill + opHeight + lintelDepth);
                    if (spaceAbove > 20) upperStud = { y: opSill + opHeight + lintelDepth, h: spaceAbove };
                    break;
                }
            }

            if (!isDeleted) {
                addMember('Common Stud', xPos, startY, 0, thickness, endY - startY, depth, COL_STUD);
            } else {
                if (lowerStud) addMember('Jack Stud', xPos, lowerStud.y, 0, thickness, lowerStud.h, depth, COL_STUD);
                if (upperStud) addMember('Cripple Stud', xPos, upperStud.y, 0, thickness, upperStud.h, depth, COL_STUD);
            }
        });

        // --- OPENINGS ---
        openings.forEach(op => {
            const opStart = parseFloat(op.startX);
            const opWidth = parseFloat(op.width);
            const opHeight = parseFloat(op.height);
            const opSill = parseFloat(op.sillHeight);
            const headHeight = opSill + opHeight;
            let lintelDepth = opWidth > 1200 ? 190 : 140;

            addMember('Jamb Stud', opStart - thickness, thickness, 0, thickness, headHeight + lintelDepth - thickness, depth, COL_STUD);
            addMember('Jamb Stud', opStart + opWidth, thickness, 0, thickness, headHeight + lintelDepth - thickness, depth, COL_STUD);
            addMember('Lintel', opStart - thickness, headHeight, 0, opWidth + (thickness * 2), lintelDepth, depth, COL_LINTEL);
            
            if (opSill > 0) addMember('Sill Trimmer', opStart, opSill, 0, opWidth, thickness, depth, COL_PLATE);
        });

        // --- NOGGINS ---
        // Re-using grid positions for noggin gaps to ensure stability
        const nogginCenter = numHeight / 2;
        for (let i = 0; i < gridPositions.length - 1; i++) {
            const x1 = gridPositions[i];
            const x2 = gridPositions[i+1];
            const gapStart = x1 + thickness + 0.5; // Physical gap
            const gapWidth = (x2 - gapStart) - 0.5;
            
            if (gapWidth < 10) continue;

            const midX = gapStart + (gapWidth/2);
            let insideOpening = false;
             for (const op of openings) {
                if (midX > op.startX && midX < op.startX + op.width) {
                    if (nogginCenter > op.sillHeight && nogginCenter < op.sillHeight + op.height) {
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

        // --- BRACING ---
        if (showBracing) {
           const frameLen = numLen - (trimStart + trimEnd);
           if (frameLen > 1800) {
               const braceRun = Math.min(frameLen - 200, 2400); 
               const startX = frameStart + (frameLen - braceRun)/2;
               const braceRise = numHeight - 200;
               const braceLen = Math.sqrt(braceRun*braceRun + braceRise*braceRise);
               const angleRad = Math.atan2(braceRise, braceRun);
               const angleDeg = angleRad * (180 / Math.PI);
               
               const zBrace = !isFlipped ? (depth + 2) : (-2);
               addMember('Metal Brace', startX, 100, zBrace, braceLen, 40, 2, COL_BRACE, angleDeg);
           }
        }

        return components;
    } catch (e) {
        console.error("Single Wall Gen Error", e);
        return [];
    }
};

const AS1684WallGenerator = () => {
  // --- STATE ---
  const [materials, setMaterials] = useState(DEFAULT_MATERIALS);
  const [walls, setWalls] = useState([
    { id: 1, name: 'Wall 1', length: 3000, height: 2400, studSize: '90x45', studSpacing: 450, openings: [], position: { x: 0, y: 0, rotation: 0 }, showBracing: true, internalLining: 'gyprock_10', externalLining: 'brick_veneer', isFlipped: false }
  ]);
  const [selectedWallId, setSelectedWallId] = useState(1);
  const [view3D, setView3D] = useState(DEFAULT_VIEW);
  const [viewMode, setViewMode] = useState('plan'); 
  const [projectionMode, setProjectionMode] = useState('perspective'); 
  const [activeTab, setActiveTab] = useState('walls'); 
  const [showSettings, setShowSettings] = useState(true);
  const [newMat, setNewMat] = useState({ name: 'New Material', thickness: 10, cavity: 0, color: '#ffffff', opacity: 0.5, type: 'external' });

  // Drawing State
  const [drawState, setDrawState] = useState({ active: false, start: null, current: null, snapped: null });
  const [dragHandle, setDragHandle] = useState(null); 
  const [hoverHandle, setHoverHandle] = useState(null); 

  // Mouse / Canvas state
  const [isDragging, setIsDragging] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  
  // Plan View State
  const [planView, setPlanView] = useState({ x: 0, y: 0, zoom: 1 });
  const [planDrag, setPlanDrag] = useState({ active: false, startX: 0, startY: 0 });

  const canvasRef = useRef(null);
  const planCanvasRef = useRef(null);

  const activeWall = walls.find(w => w.id === selectedWallId) || walls[0];

  // --- HELPERS ---
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
    setWalls([...walls, { id: newId, name: `Wall ${walls.length + 1}`, length: 3000, height: 2400, studSize: '90x45', studSpacing: 450, openings: [], position: newPos, showBracing: true, internalLining: 'gyprock_10', externalLining: 'brick_veneer', isFlipped: false }]);
    setSelectedWallId(newId);
    setActiveTab('editor');
  };

  const addMaterial = () => {
      const id = newMat.name.toLowerCase().replace(/\s/g, '_') + '_' + Date.now();
      setMaterials([...materials, { ...newMat, id }]);
      setNewMat({ name: 'New Material', thickness: 10, cavity: 0, color: '#ffffff', opacity: 0.5, type: 'external' });
  };

  // --- JUNCTION SOLVER (Auto-Join Logic) ---
  const solvedWalls = useMemo(() => {
      // Clone walls to avoid mutation and reset solve state
      const result = walls.map(w => ({...w, trimStart: 0, trimEnd: 0, cornerTypeStart: null, cornerTypeEnd: null }));
      
      const SNAP_DIST = 150;

      for (let i = 0; i < result.length; i++) {
          for (let j = 0; j < result.length; j++) {
              if (i === j) continue;
              
              const w1 = result[i];
              const w2 = result[j];
              
              const r1 = w1.position.rotation * (Math.PI/180);
              const w1Start = w1.position;
              const w1End = { x: w1Start.x + Math.cos(r1)*w1.length, y: w1Start.y + Math.sin(r1)*w1.length };
              
              const r2 = w2.position.rotation * (Math.PI/180);
              const w2Start = w2.position;
              const w2End = { x: w2Start.x + Math.cos(r2)*w2.length, y: w2Start.y + Math.sin(r2)*w2.length };

              const { d: depth2 } = TIMBER_SIZES[w2.studSize] || TIMBER_SIZES['90x45'];

              if (dist(w1Start, w2End) < SNAP_DIST) {
                  w1.trimStart = depth2;
                  w2.cornerTypeEnd = 'through';
              }
              else if (dist(w1End, w2Start) < SNAP_DIST) {
                  w1.trimEnd = depth2;
                  w2.cornerTypeStart = 'through';
              }
              else if (dist(w1Start, w2Start) < SNAP_DIST) {
                  w1.trimStart = depth2;
                  w2.cornerTypeStart = 'through';
              }
              else if (dist(w1End, w2End) < SNAP_DIST) {
                  w1.trimEnd = depth2;
                  w2.cornerTypeEnd = 'through';
              }
          }
      }
      return result;
  }, [walls]);

  // --- HOUSE GENERATION ---
  const houseGeometry = useMemo(() => {
    let allComponents = [];
    solvedWalls.forEach(wall => {
      const localParts = generateSingleWallFrame(wall, materials, wall.trimStart, wall.trimEnd, wall.cornerTypeStart, wall.cornerTypeEnd);
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
  }, [solvedWalls, materials]);

  // --- BOM ENGINE ---
  const globalBOM = useMemo(() => {
    const rawGroups = {};
    const liningGroups = {};

    // 1. Structural BOM
    houseGeometry.forEach(item => {
      if (item.type.includes('Lining')) return;
      const sizeKey = item.sectionSize || "Misc";
      if (!rawGroups[sizeKey]) rawGroups[sizeKey] = { pieces: [], cutList: {}, totalLM: 0 };
      rawGroups[sizeKey].pieces.push(item.cutLength);
      const itemKey = `${item.type} @ ${item.cutLength}mm`;
      if (!rawGroups[sizeKey].cutList[itemKey]) rawGroups[sizeKey].cutList[itemKey] = { type: item.type, len: item.cutLength, count: 0 };
      rawGroups[sizeKey].cutList[itemKey].count++;
      rawGroups[sizeKey].totalLM += item.cutLength;
    });
    walls.forEach(w => {
        let area = (w.length * w.height) / 1000000; 
        w.openings.forEach(op => { area -= (op.width * op.height) / 1000000; });
        if (w.internalLining && w.internalLining !== 'none') {
            const mat = materials.find(m => m.id === w.internalLining);
            if (mat) {
                const key = mat.name;
                if (!liningGroups[key]) liningGroups[key] = 0;
                liningGroups[key] += area;
            }
        }
        if (w.externalLining && w.externalLining !== 'none') {
            const mat = materials.find(m => m.id === w.externalLining);
            if (mat) {
                const key = mat.name;
                if (!liningGroups[key]) liningGroups[key] = 0;
                liningGroups[key] += area;
            }
        }
    });
    Object.keys(rawGroups).forEach(sizeKey => {
      if (sizeKey === 'Metal Strap' || sizeKey === 'Misc') return;
      const pieces = [...rawGroups[sizeKey].pieces].sort((a, b) => b - a);
      const bins = [];
      pieces.forEach(piece => {
        let fitted = false;
        for (let bin of bins) {
          if (bin.remaining >= piece + 5) { bin.remaining -= (piece + 5); bin.cuts.push(piece); fitted = true; break; }
        }
        if (!fitted) {
          const bestStock = COMMON_ORDER_LENGTHS.find(l => l >= piece);
          if (bestStock) { bins.push({ length: bestStock, remaining: bestStock - piece - 5, cuts: [piece] }); } 
          else { bins.push({ length: Math.ceil(piece / 600) * 600, remaining: 0, cuts: [piece] }); }
        }
      });
      const orderSummary = {};
      bins.forEach(bin => { if (!orderSummary[bin.length]) orderSummary[bin.length] = 0; orderSummary[bin.length]++; });
      rawGroups[sizeKey].orderList = orderSummary;
    });
    return { structural: rawGroups, linings: liningGroups };
  }, [houseGeometry, walls, materials]);

  // --- INPUT HANDLERS ---
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (drawState.active) setDrawState({ active: false, start: null, current: null, snapped: null });
        if (dragHandle) setDragHandle(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [drawState.active, dragHandle]);

  const getPlanCoordinates = (e) => {
    if (!planCanvasRef.current) return { x: 0, y: 0 };
    const rect = planCanvasRef.current.getBoundingClientRect();
    const scaleX = planCanvasRef.current.width / rect.width;
    const scaleY = planCanvasRef.current.height / rect.height;
    const rawX = (e.clientX - rect.left) * scaleX;
    const rawY = (e.clientY - rect.top) * scaleY;
    const mx = (rawX - planCanvasRef.current.width/2 - planView.x) / planView.zoom;
    const my = (rawY - planCanvasRef.current.height/2 - planView.y) / planView.zoom;
    return { x: mx, y: my };
  };

  const getSnappedPosition = (mx, my, excludeWallId = null) => {
    let snapX = Math.round(mx / 100) * 100;
    let snapY = Math.round(my / 100) * 100;
    let isSnapToWall = false;
    const snapRadius = 25 / planView.zoom; 
    walls.forEach(w => {
      if (w.id === excludeWallId) return;
      const startX = w.position.x;
      const startY = w.position.y;
      const rad = w.position.rotation * (Math.PI/180);
      const endX = startX + Math.cos(rad) * w.length;
      const endY = startY + Math.sin(rad) * w.length;
      if (dist({x:mx, y:my}, {x:startX, y:startY}) < snapRadius) { snapX = startX; snapY = startY; isSnapToWall = true; }
      if (dist({x:mx, y:my}, {x:endX, y:endY}) < snapRadius) { snapX = endX; snapY = endY; isSnapToWall = true; }
    });
    return { x: snapX, y: snapY, isSnapToWall };
  };

  const checkHoverHandle = (mx, my) => {
      const handleRadius = 15 / planView.zoom;
      let found = null;
      walls.forEach(w => {
          const p1 = w.position;
          const rad = w.position.rotation * (Math.PI/180);
          const p2 = { x: p1.x + Math.cos(rad)*w.length, y: p1.y + Math.sin(rad)*w.length };
          if (dist({x:mx, y:my}, p1) < handleRadius) found = { wallId: w.id, type: 'start' };
          else if (dist({x:mx, y:my}, p2) < handleRadius) found = { wallId: w.id, type: 'end' };
      });
      if (found?.wallId !== hoverHandle?.wallId || found?.type !== hoverHandle?.type) setHoverHandle(found);
      return found;
  };

  const handlePlanMouseDown = (e) => {
    const { x: mx, y: my } = getPlanCoordinates(e);
    const clickedHandle = checkHoverHandle(mx, my);
    if (clickedHandle && !drawState.active) { setDragHandle(clickedHandle); setSelectedWallId(clickedHandle.wallId); return; }
    if (activeTab === 'walls' && drawState.active) {
        const snapped = getSnappedPosition(mx, my);
        const finalX = snapped.x;
        const finalY = snapped.y;
        if (!drawState.start) {
            setDrawState({ ...drawState, start: { x: finalX, y: finalY }, current: { x: finalX, y: finalY }, snapped: snapped.isSnapToWall });
        } else {
            const p1 = drawState.start;
            const p2 = { x: finalX, y: finalY };
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const len = Math.sqrt(dx*dx + dy*dy);
            if (len > 100) {
                const rot = Math.atan2(dy, dx) * (180/Math.PI);
                const newId = Date.now();
                setWalls([...walls, {
                    id: newId, name: `Wall ${walls.length + 1}`, length: Math.round(len), height: 2400, studSize: '90x45', studSpacing: 450, 
                    openings: [], position: { x: p1.x, y: p1.y, rotation: Math.round(rot) }, showBracing: true,
                    internalLining: 'gyprock_10', externalLining: 'brick_veneer', isFlipped: false
                }]);
                setSelectedWallId(newId);
                setDrawState({ ...drawState, start: p2, current: p2, snapped: snapped.isSnapToWall });
            }
        }
    } else {
        setPlanDrag({ active: true, startX: e.clientX, startY: e.clientY });
    }
  };

  const handlePlanMouseMove = (e) => {
      const { x: mx, y: my } = getPlanCoordinates(e);
      if (dragHandle) {
          const snapped = getSnappedPosition(mx, my, dragHandle.wallId);
          const target = { x: snapped.x, y: snapped.y };
          if (e.shiftKey) {
             const w = walls.find(w => w.id === dragHandle.wallId);
             if (w) {
                 const rad = w.position.rotation * (Math.PI/180);
                 const pStart = w.position;
                 const pEnd = { x: pStart.x + Math.cos(rad)*w.length, y: pStart.y + Math.sin(rad)*w.length };
                 const refPoint = dragHandle.type === 'start' ? pEnd : pStart;
                 const dx = Math.abs(target.x - refPoint.x);
                 const dy = Math.abs(target.y - refPoint.y);
                 if (dx > dy) target.y = refPoint.y; else target.x = refPoint.x;
             }
          }
          setWalls(prev => prev.map(w => {
              if (w.id !== dragHandle.wallId) return w;
              let newPos = w.position;
              let newLen = w.length;
              if (dragHandle.type === 'start') {
                  const rad = w.position.rotation * (Math.PI/180);
                  const pEnd = { x: w.position.x + Math.cos(rad)*w.length, y: w.position.y + Math.sin(rad)*w.length };
                  const dx = pEnd.x - target.x;
                  const dy = pEnd.y - target.y;
                  newLen = Math.sqrt(dx*dx + dy*dy);
                  const newRot = Math.atan2(dy, dx) * (180/Math.PI);
                  newPos = { x: target.x, y: target.y, rotation: Math.round(newRot) };
              } else {
                  const dx = target.x - w.position.x;
                  const dy = target.y - w.position.y;
                  newLen = Math.sqrt(dx*dx + dy*dy);
                  const newRot = Math.atan2(dy, dx) * (180/Math.PI);
                  newPos = { ...w.position, rotation: Math.round(newRot) };
              }
              return { ...w, position: newPos, length: Math.round(newLen) };
          }));
          return;
      }
      if (activeTab === 'walls' && drawState.active) {
        const snapped = getSnappedPosition(mx, my);
        let targetX = snapped.x;
        let targetY = snapped.y;
        if (drawState.start) {
            if (e.shiftKey) {
                const dx = Math.abs(targetX - drawState.start.x);
                const dy = Math.abs(targetY - drawState.start.y);
                if (dx > dy) targetY = drawState.start.y; else targetX = drawState.start.x;
            } else {
                if (Math.abs(targetX - drawState.start.x) < (300/planView.zoom)) targetX = drawState.start.x;
                if (Math.abs(targetY - drawState.start.y) < (300/planView.zoom)) targetY = drawState.start.y;
            }
        }
        setDrawState(prev => ({ ...prev, current: { x: targetX, y: targetY }, snapped: snapped.isSnapToWall }));
      } else if (planDrag.active) {
          const dx = e.clientX - planDrag.startX;
          const dy = e.clientY - planDrag.startY;
          setPlanView(prev => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
          setPlanDrag({ ...planDrag, startX: e.clientX, startY: e.clientY });
      } else {
          checkHoverHandle(mx, my);
      }
  };

  const handlePlanMouseUp = () => {
      setPlanDrag({ ...planDrag, active: false });
      setDragHandle(null);
  };

  const handlePlanWheel = (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      setPlanView(prev => ({ ...prev, zoom: Math.max(0.1, Math.min(5, prev.zoom * delta)) }));
  };

  // --- RENDER PLAN LOOP ---
  useEffect(() => {
      if (viewMode !== 'plan') return;
      const canvas = planCanvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const width = canvas.width;
      const height = canvas.height;

      ctx.fillStyle = '#1e293b'; 
      ctx.fillRect(0, 0, width, height);
      
      const cx = width/2 + planView.x;
      const cy = height/2 + planView.y;
      
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1;
      const gridSize = 1000 * planView.zoom;
      const startX = cx % gridSize;
      const startY = cy % gridSize;
      
      ctx.beginPath();
      for (let x = startX; x < width; x += gridSize) { ctx.moveTo(x, 0); ctx.lineTo(x, height); }
      for (let y = startY; y < height; y += gridSize) { ctx.moveTo(0, y); ctx.lineTo(width, y); }
      ctx.stroke();

      // Draw Solved Walls
      solvedWalls.forEach(w => {
          const startX = cx + (w.position.x * planView.zoom);
          const startY = cy + (w.position.y * planView.zoom);
          const rad = w.position.rotation * (Math.PI / 180);
          const endX = startX + (Math.cos(rad) * w.length * planView.zoom);
          const endY = startY + (Math.sin(rad) * w.length * planView.zoom);
          
          const isSel = w.id === selectedWallId;
          const isHover = hoverHandle && hoverHandle.wallId === w.id;
          const { d: studDepth } = TIMBER_SIZES[w.studSize] || TIMBER_SIZES['90x45'];
          const intMat = materials.find(m => m.id === w.internalLining) || DEFAULT_MATERIALS[0];
          const extMat = materials.find(m => m.id === w.externalLining) || DEFAULT_MATERIALS[0];

          const dx = endX - startX; const dy = endY - startY;
          const len = Math.sqrt(dx*dx + dy*dy);
          const nx = -dy / len; const ny = dx / len;
          const dirInt = w.isFlipped ? 1 : -1; const dirExt = w.isFlipped ? -1 : 1;
          
          const trimStartPx = w.trimStart * planView.zoom;
          const trimEndPx = w.trimEnd * planView.zoom;
          const fx = dx/len; const fy = dy/len;
          const fsx = startX + fx * trimStartPx;
          const fsy = startY + fy * trimStartPx;
          const fex = endX - fx * trimEndPx;
          const fey = endY - fy * trimEndPx;

          ctx.strokeStyle = isSel ? '#8B5A2B' : '#5D4037';
          ctx.lineWidth = studDepth * planView.zoom;
          ctx.lineCap = 'butt';
          ctx.beginPath(); ctx.moveTo(fsx, fsy); ctx.lineTo(fex, fey); ctx.stroke();

          if (intMat.thickness > 0) {
              const dist = (studDepth/2 + intMat.cavity + intMat.thickness/2) * planView.zoom * dirInt;
              ctx.beginPath(); ctx.moveTo(startX+nx*dist, startY+ny*dist); ctx.lineTo(endX+nx*dist, endY+ny*dist);
              ctx.lineWidth = intMat.thickness * planView.zoom; ctx.strokeStyle = intMat.color; ctx.stroke();
          }
          if (extMat.thickness > 0) {
              const dist = (studDepth/2 + extMat.cavity + extMat.thickness/2) * planView.zoom * dirExt;
              ctx.beginPath(); ctx.moveTo(startX+nx*dist, startY+ny*dist); ctx.lineTo(endX+nx*dist, endY+ny*dist);
              ctx.lineWidth = extMat.thickness * planView.zoom; ctx.strokeStyle = extMat.color; ctx.stroke();
          }
          
          const handleSize = 5;
          ctx.fillStyle = (isHover && hoverHandle.type === 'start') ? '#22c55e' : '#fff';
          ctx.beginPath(); ctx.arc(startX, startY, handleSize, 0, Math.PI*2); ctx.fill();
          ctx.fillStyle = (isHover && hoverHandle.type === 'end') ? '#22c55e' : '#fff';
          ctx.beginPath(); ctx.arc(endX, endY, handleSize, 0, Math.PI*2); ctx.fill();
      });

      if (drawState.active) {
          const cursorPos = drawState.current || { x: 0, y: 0 };
          const sx = cx + (cursorPos.x * planView.zoom);
          const sy = cy + (cursorPos.y * planView.zoom);

          ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 1;
          const crossSize = 10;
          ctx.beginPath(); ctx.moveTo(sx - crossSize, sy); ctx.lineTo(sx + crossSize, sy); ctx.moveTo(sx, sy - crossSize); ctx.lineTo(sx, sy + crossSize); ctx.stroke();

          if (drawState.snapped) {
              ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 2;
              ctx.beginPath(); ctx.arc(sx, sy, 8, 0, Math.PI*2); ctx.stroke();
          }
          if (drawState.start) {
              const startScreenX = cx + (drawState.start.x * planView.zoom);
              const startScreenY = cy + (drawState.start.y * planView.zoom);
              ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 90 * planView.zoom; ctx.globalAlpha = 0.5;
              ctx.beginPath(); ctx.moveTo(startScreenX, startScreenY); ctx.lineTo(sx, sy); ctx.stroke(); ctx.globalAlpha = 1.0;
              
              const d = dist(drawState.start, cursorPos);
              ctx.fillStyle = '#fff'; ctx.font = '12px monospace'; ctx.fillText(`${Math.round(d)}mm`, (startScreenX+sx)/2, (startScreenY+sy)/2 - 10);
          }
      }
  }, [solvedWalls, viewMode, planView, selectedWallId, drawState, hoverHandle, materials]);

  // --- RENDER 3D ---
  useEffect(() => {
    if (viewMode !== '3d') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    ctx.fillStyle = '#111827'; 
    ctx.fillRect(0, 0, width, height);
    
    if (houseGeometry.length === 0) return;

    const scale = view3D.zoom;
    const project = (x, y, z) => {
      let dx = x; let dy = y; let dz = z;
      const radY = view3D.rotY * (Math.PI / 180); const radX = view3D.rotX * (Math.PI / 180);
      let x1 = dx * Math.cos(radY) - dz * Math.sin(radY);
      let z1 = dx * Math.sin(radY) + dz * Math.cos(radY);
      let y2 = dy * Math.cos(radX) - z1 * Math.sin(radX);
      let z2 = dy * Math.sin(radX) + z1 * Math.cos(radX);
      const dist = 4000 + z2; 
      let f = projectionMode === 'orthographic' ? 1 : 4000 / (dist < 100 ? 100 : dist); 
      return { x: (width / 2) + (x1 * f) * scale + view3D.panX, y: (height / 2) - (y2 * f) * scale + view3D.panY, z: z2 };
    };

    let allFaces = [];
    houseGeometry.forEach(comp => {
      const { x, y, z, len, w, d, color, rotation, worldTransform, wallId, opacity } = comp;
      const isSelected = wallId === selectedWallId;
      const baseColor = isSelected ? color : adjustColor(color, -60); 
      const rawVerts = [{x:0,y:0,z:0}, {x:len,y:0,z:0}, {x:len,y:w,z:0}, {x:0,y:w,z:0}, {x:0,y:0,z:d}, {x:len,y:0,z:d}, {x:len,y:w,z:d}, {x:0,y:w,z:d}];
      const worldVerts = rawVerts.map(v => {
          const localRot = rotatePoint(v.x, v.y, rotation);
          const lx = x + localRot.x; const ly = y + localRot.y; const lz = z + v.z;
          const wRad = (worldTransform.rotation || 0) * (Math.PI / 180);
          const wx_rot = lx * Math.cos(wRad) - lz * Math.sin(wRad);
          const wz_rot = lx * Math.sin(wRad) + lz * Math.cos(wRad);
          return { x: wx_rot + worldTransform.x, y: ly, z: wz_rot + worldTransform.z };
      });
      const p = worldVerts.map(pt => project(pt.x, pt.y, pt.z));
      const faces = [{ v: [0, 1, 2, 3], c: baseColor }, { v: [5, 4, 7, 6], c: adjustColor(baseColor, -60) }, { v: [4, 0, 3, 7], c: adjustColor(baseColor, -30) }, { v: [1, 5, 6, 2], c: adjustColor(baseColor, -30) }, { v: [3, 2, 6, 7], c: adjustColor(baseColor, 40) }, { v: [4, 5, 1, 0], c: adjustColor(baseColor, -50) }];
      faces.forEach(face => {
        const minZ = Math.min(p[face.v[0]].z, p[face.v[1]].z, p[face.v[2]].z, p[face.v[3]].z);
        allFaces.push({ pts: face.v.map(i => p[i]), z: minZ, color: face.c, opacity: opacity || 1.0 });
      });
    });
    allFaces.sort((a, b) => b.z - a.z);
    allFaces.forEach(f => {
      ctx.beginPath(); ctx.moveTo(f.pts[0].x, f.pts[0].y); ctx.lineTo(f.pts[1].x, f.pts[1].y); ctx.lineTo(f.pts[2].x, f.pts[2].y); ctx.lineTo(f.pts[3].x, f.pts[3].y); ctx.closePath();
      ctx.globalAlpha = f.opacity; ctx.fillStyle = f.color; ctx.fill();
      ctx.strokeStyle = '#00000099'; ctx.lineWidth = 0.8; ctx.stroke(); ctx.globalAlpha = 1.0;
    });
  }, [houseGeometry, view3D, selectedWallId, projectionMode, viewMode]);

  // --- MOUSE HANDLERS ---
  const handleMouseDown = (e) => {
    if (viewMode === 'plan') { handlePlanMouseDown(e); return; }
    if (e.shiftKey) setIsPanning(true); else setIsDragging(true);
    setDragStart({ x: e.clientX, y: e.clientY });
  };
  const handleMouseMove = (e) => {
    if (viewMode === 'plan') { handlePlanMouseMove(e); return; }
    if (!isDragging && !isPanning) return;
    const dx = e.clientX - dragStart.x; const dy = e.clientY - dragStart.y;
    setDragStart({ x: e.clientX, y: e.clientY });
    if (isPanning) setView3D(v => ({ ...v, panX: v.panX + dx, panY: v.panY + dy }));
    else setView3D(v => ({ ...v, rotY: v.rotY + dx * 0.5, rotX: Math.max(-90, Math.min(90, v.rotX - dy * 0.5)) }));
  };
  const handleExport = () => { alert("Exporting to OBJ..."); };
  const toggleWallFlip = () => { updateActiveWall('isFlipped', !activeWall.isFlipped); };

  return (
    <div className="w-full h-screen bg-gray-950 text-gray-100 flex overflow-hidden font-sans">
      {/* SIDEBAR */}
      <div className={`flex-shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col transition-all ${showSettings ? 'w-80' : 'w-0 overflow-hidden'}`}>
        {/* Header */}
        <div className="p-4 border-b border-gray-800 flex justify-between items-center bg-gray-900">
          <h1 className="font-bold flex items-center gap-2"><Home className="w-5 h-5 text-blue-500" /> House Builder</h1>
          <div className="flex gap-1 bg-gray-800 rounded p-1">
             <button onClick={() => setActiveTab('walls')} className={`px-2 py-1 text-xs rounded ${activeTab==='walls'?'bg-blue-600':'hover:bg-gray-700'}`}>Layout</button>
             <button onClick={() => setActiveTab('editor')} className={`px-2 py-1 text-xs rounded ${activeTab==='editor'?'bg-blue-600':'hover:bg-gray-700'}`}>Edit</button>
             <button onClick={() => setActiveTab('materials')} className={`px-2 py-1 text-xs rounded ${activeTab==='materials'?'bg-blue-600':'hover:bg-gray-700'}`}>Mat.</button>
             <button onClick={() => setActiveTab('bom')} className={`px-2 py-1 text-xs rounded ${activeTab==='bom'?'bg-blue-600':'hover:bg-gray-700'}`}>BOM</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {/* TAB CONTENT: WALLS, EDITOR, MATERIALS, BOM (Same as previous but optimized logic inside) */}
          {activeTab === 'walls' && (
            <div className="space-y-4">
               <div className="bg-gray-800 rounded p-3 border border-gray-700">
                  <h3 className="text-xs font-bold text-gray-400 uppercase mb-2 flex items-center gap-1"><PenTool className="w-3 h-3"/> Tools</h3>
                  <div className="flex gap-2">
                     <button onClick={() => { setViewMode('plan'); setDrawState(s => ({...s, active: !s.active, start: null})); }} className={`flex-1 p-2 rounded text-xs text-center border transition flex items-center justify-center gap-2 ${drawState.active ? 'bg-green-600 border-green-500 text-white' : 'bg-gray-700 border-gray-600 hover:bg-gray-600'}`}>
                        {drawState.active ? 'Drawing... (Esc to Cancel)' : 'Draw Wall'}
                     </button>
                  </div>
               </div>
               <div className="space-y-2">
                 {walls.map(w => (
                   <div key={w.id} onClick={() => { setSelectedWallId(w.id); setActiveTab('editor'); }} className={`p-3 rounded border cursor-pointer flex justify-between ${selectedWallId===w.id?'bg-blue-900/40 border-blue-500':'bg-gray-800 border-gray-700'}`}>
                      <span className="text-sm font-semibold">{w.name}</span>
                      <span className="text-xs text-gray-500 bg-gray-900 px-1 rounded">{w.length}mm</span>
                   </div>
                 ))}
               </div>
            </div>
          )}
          
          {activeTab === 'editor' && (
             <div className="space-y-4">
                <div className="flex justify-between">
                    <input className="bg-transparent border-b w-32 font-bold" value={activeWall.name} onChange={e => updateActiveWall('name', e.target.value)} />
                    <div className="flex gap-2">
                        <button onClick={toggleWallFlip} className="p-1 text-blue-400 hover:bg-gray-800 rounded" title="Flip Wall Side"><ArrowLeftRight className="w-4 h-4"/></button>
                        <button onClick={() => { if(walls.length>1) setWalls(walls.filter(w=>w.id!==selectedWallId)); }} className="p-1 text-red-400 hover:bg-gray-800 rounded"><Trash2 className="w-4 h-4"/></button>
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <div><label className="text-xs text-gray-400">Length</label><input type="number" value={activeWall.length} onChange={e => updateActiveWall('length', e.target.value)} className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm"/></div>
                    <div><label className="text-xs text-gray-400">Height</label><input type="number" value={activeWall.height} onChange={e => updateActiveWall('height', e.target.value)} className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm"/></div>
                </div>
                <div className="space-y-2 pt-2 border-t border-gray-700">
                    <label className="text-xs text-gray-400 block">Linings</label>
                    <select value={activeWall.internalLining} onChange={e => updateActiveWall('internalLining', e.target.value)} className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs">{materials.filter(m=>m.type!=='external').map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select>
                    <select value={activeWall.externalLining} onChange={e => updateActiveWall('externalLining', e.target.value)} className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs">{materials.filter(m=>m.type!=='internal').map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select>
                </div>
                <div className="space-y-2 pt-2 border-t border-gray-700">
                    <div className="flex justify-between"><label className="text-xs text-gray-400">Openings</label><button onClick={()=>updateActiveWall('openings', [...activeWall.openings, {id:Date.now(), startX:500, width:900, height:2100, sillHeight:0}])}><Plus className="w-4 h-4 text-blue-400"/></button></div>
                    {activeWall.openings.map((op, idx) => (
                        <div key={op.id} className="bg-gray-800 p-2 rounded border border-gray-600 grid grid-cols-2 gap-2">
                             <input type="number" value={op.startX} onChange={e=>{const n=[...activeWall.openings]; n[idx].startX=e.target.value; updateActiveWall('openings', n)}} className="bg-gray-900 border-gray-700 rounded px-1 text-xs" placeholder="X"/>
                             <input type="number" value={op.width} onChange={e=>{const n=[...activeWall.openings]; n[idx].width=e.target.value; updateActiveWall('openings', n)}} className="bg-gray-900 border-gray-700 rounded px-1 text-xs" placeholder="W"/>
                        </div>
                    ))}
                </div>
             </div>
          )}
          
          {activeTab === 'materials' && (
            <div className="space-y-4">
                <h3 className="text-xs font-bold text-gray-500 uppercase flex items-center gap-2"><Palette className="w-4 h-4"/> Material Creator</h3>
                <div className="bg-gray-800 p-3 rounded border border-gray-700 space-y-3">
                    <div><label className="text-[10px] text-gray-400">Name</label><input type="text" value={newMat.name} onChange={e => setNewMat({...newMat, name: e.target.value})} className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-sm text-white" /></div>
                    <div className="grid grid-cols-2 gap-2">
                        <div><label className="text-[10px] text-gray-400">Thick (mm)</label><input type="number" value={newMat.thickness} onChange={e => setNewMat({...newMat, thickness: parseFloat(e.target.value)})} className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-sm text-white" /></div>
                        <div><label className="text-[10px] text-gray-400">Cavity (mm)</label><input type="number" value={newMat.cavity} onChange={e => setNewMat({...newMat, cavity: parseFloat(e.target.value)})} className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-sm text-white" /></div>
                    </div>
                    <div><label className="text-[10px] text-gray-400">Color</label><input type="color" value={newMat.color} onChange={e => setNewMat({...newMat, color: e.target.value})} className="w-full h-8 bg-gray-900 border border-gray-600 rounded cursor-pointer" /></div>
                    <button onClick={addMaterial} className="w-full bg-blue-600 hover:bg-blue-500 text-white py-1 rounded text-sm font-bold">Add Material</button>
                </div>
            </div>
          )}
          
          {activeTab === 'bom' && (
            <div className="space-y-4">
               <h3 className="text-xs font-bold text-gray-500 uppercase flex gap-2"><ShoppingCart className="w-4 h-4"/> Global Order</h3>
               <div className="space-y-4">
                 <div className="text-xs text-blue-400 font-bold uppercase tracking-wider">Framing</div>
                 {Object.keys(globalBOM.structural).map(section => (
                   <div key={section} className="bg-gray-800 rounded border border-gray-700 overflow-hidden text-xs p-2 flex justify-between">
                       <span>{section}</span><span className="text-gray-500">{((globalBOM.structural[section].totalLM)/1000).toFixed(1)}m</span>
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
             <div className="bg-gray-900 rounded p-1 flex gap-1 border border-gray-700">
                <button onClick={() => setViewMode('plan')} className={`px-3 py-1 rounded text-xs font-bold ${viewMode==='plan'?'bg-blue-600 text-white':'text-gray-400 hover:text-white'}`}>2D</button>
                <button onClick={() => setViewMode('3d')} className={`px-3 py-1 rounded text-xs font-bold ${viewMode==='3d'?'bg-blue-600 text-white':'text-gray-400 hover:text-white'}`}>3D</button>
             </div>
             {viewMode === '3d' && (
               <button onClick={() => setProjectionMode(m => m === 'perspective' ? 'orthographic' : 'perspective')} className={`p-2 rounded shadow border border-gray-600 text-white transition ${projectionMode === 'orthographic' ? 'bg-blue-600' : 'bg-gray-800 hover:bg-gray-700'}`} title="Toggle Ortho/Persp">
                  {projectionMode === 'perspective' ? <Box className="w-4 h-4" /> : <Grid className="w-4 h-4" />}
               </button>
             )}
             <button onClick={handleExport} className="bg-blue-600 hover:bg-blue-500 text-white p-2 rounded shadow"><Download className="w-4 h-4"/></button>
         </div>
         
         {viewMode === 'plan' ? (
            <>
                <canvas ref={planCanvasRef} width={1600} height={1200} className="w-full h-full cursor-crosshair block"
                  onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handlePlanMouseUp} onMouseLeave={handlePlanMouseUp} onWheel={handlePlanWheel}
                />
                <div className="absolute bottom-12 right-4 flex flex-col gap-2">
                    <button onClick={()=>setPlanView(p=>({...p, zoom:p.zoom*1.2}))} className="bg-gray-800 p-2 rounded text-white"><ZoomIn className="w-4 h-4"/></button>
                    <button onClick={()=>setPlanView(p=>({...p, zoom:p.zoom/1.2}))} className="bg-gray-800 p-2 rounded text-white"><ZoomOut className="w-4 h-4"/></button>
                </div>
            </>
         ) : (
            <canvas ref={canvasRef} width={1600} height={1200} className="w-full h-full cursor-move block"
              onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={()=>{setIsDragging(false);setIsPanning(false)}} onMouseLeave={()=>{setIsDragging(false);setIsPanning(false)}}
              onWheel={(e)=>setView3D(v=>({...v, zoom:Math.max(0.1, v.zoom-e.deltaY*0.001)}))}
            />
         )}
         <div className="absolute bottom-4 left-4 text-gray-500 text-xs pointer-events-none select-none">
            {viewMode === 'plan' ? 'Click to Draw Wall • Drag to Pan' : 'Left Drag: Rotate • Shift+Drag: Pan • Scroll: Zoom'}
         </div>
      </div>
    </div>
  );
};

export default AS1684WallGenerator;
