import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Download, Plus, Trash2, Settings, Move, ZoomIn, RotateCw, X, Grid, FileText, Sparkles, CheckCircle, AlertTriangle, Layers, ShoppingCart, Home, Copy, LayoutTemplate, Box, PenTool, MousePointer, ZoomOut } from 'lucide-react';

// --- CONSTANTS ---
const TIMBER_SIZES = {
  '70x35': { d: 70, t: 35, grade: 'MGP10' },
  '90x35': { d: 90, t: 35, grade: 'MGP10' },
  '90x45': { d: 90, t: 45, grade: 'MGP10' },
  '140x45': { d: 140, t: 45, grade: 'MGP12' }
};

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

const dist = (p1, p2) => Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));

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

        // --- REAL WORLD SITE COLORS ---
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
  const [viewMode, setViewMode] = useState('plan'); // '3d' or 'plan'
  const [projectionMode, setProjectionMode] = useState('perspective'); 
  const [activeTab, setActiveTab] = useState('walls'); 
  const [showSettings, setShowSettings] = useState(true);

  // Drawing State
  const [drawState, setDrawState] = useState({ active: false, start: null, current: null, snapped: null });
  
  // Modification State (Moving points)
  const [dragHandle, setDragHandle] = useState(null); // { wallId, type: 'start'|'end' }
  const [hoverHandle, setHoverHandle] = useState(null); // { wallId, type: 'start'|'end' }

  // Mouse / Canvas state
  const [isDragging, setIsDragging] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  
  // Plan View State
  const [planView, setPlanView] = useState({ x: 0, y: 0, zoom: 1 });
  const [planDrag, setPlanDrag] = useState({ active: false, startX: 0, startY: 0 });

  const canvasRef = useRef(null);
  const planCanvasRef = useRef(null);

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

  // --- KEYBOARD HANDLERS (Escape) ---
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (drawState.active) {
          setDrawState({ active: false, start: null, current: null, snapped: null });
        }
        if (dragHandle) {
            setDragHandle(null);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [drawState.active, dragHandle]);

  // --- PLAN VIEW LOGIC ---
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
      if (w.id === excludeWallId) return; // Don't snap to self if modifying self
      const startX = w.position.x;
      const startY = w.position.y;
      const rad = w.position.rotation * (Math.PI/180);
      const endX = startX + Math.cos(rad) * w.length;
      const endY = startY + Math.sin(rad) * w.length;
      
      if (dist({x:mx, y:my}, {x:startX, y:startY}) < snapRadius) { 
          snapX = startX; snapY = startY; isSnapToWall = true;
      }
      if (dist({x:mx, y:my}, {x:endX, y:endY}) < snapRadius) { 
          snapX = endX; snapY = endY; isSnapToWall = true;
      }
    });

    return { x: snapX, y: snapY, isSnapToWall };
  };

  // Check for hover over endpoints
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
      
      setHoverHandle(found);
      return found;
  };

  const handlePlanMouseDown = (e) => {
    const { x: mx, y: my } = getPlanCoordinates(e);

    // 1. Check if clicking a handle to modify
    const clickedHandle = checkHoverHandle(mx, my);
    if (clickedHandle && !drawState.active) {
        setDragHandle(clickedHandle);
        setSelectedWallId(clickedHandle.wallId);
        return;
    }

    // 2. Drawing Logic
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
                    id: newId,
                    name: `Wall ${walls.length + 1}`,
                    length: Math.round(len),
                    height: 2400,
                    studSize: '90x45',
                    studSpacing: 450,
                    openings: [],
                    position: { x: p1.x, y: p1.y, rotation: Math.round(rot) },
                    showBracing: true
                }]);
                setSelectedWallId(newId);
                setDrawState({ ...drawState, start: p2, current: p2, snapped: snapped.isSnapToWall });
            }
        }
    } else {
        // 3. Panning Logic
        setPlanDrag({ active: true, startX: e.clientX, startY: e.clientY });
    }
  };

  const handlePlanMouseMove = (e) => {
      const { x: mx, y: my } = getPlanCoordinates(e);

      // Handle Modifying Wall (Dragging Point)
      if (dragHandle) {
          const snapped = getSnappedPosition(mx, my, dragHandle.wallId);
          const target = { x: snapped.x, y: snapped.y };
          
          // SHIFT KEY ORTHO CONSTRAINT
          if (e.shiftKey) {
             const w = walls.find(w => w.id === dragHandle.wallId);
             if (w) {
                 const rad = w.position.rotation * (Math.PI/180);
                 const pStart = w.position;
                 const pEnd = { x: pStart.x + Math.cos(rad)*w.length, y: pStart.y + Math.sin(rad)*w.length };
                 const refPoint = dragHandle.type === 'start' ? pEnd : pStart;

                 const dx = Math.abs(target.x - refPoint.x);
                 const dy = Math.abs(target.y - refPoint.y);

                 if (dx > dy) target.y = refPoint.y; 
                 else target.x = refPoint.x;
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

      // Drawing Tool
      if (activeTab === 'walls' && drawState.active) {
        const snapped = getSnappedPosition(mx, my);
        let targetX = snapped.x;
        let targetY = snapped.y;

        // Draw State Ortho
        if (drawState.start) {
            if (e.shiftKey) {
                const dx = Math.abs(targetX - drawState.start.x);
                const dy = Math.abs(targetY - drawState.start.y);
                if (dx > dy) targetY = drawState.start.y;
                else targetX = drawState.start.x;
            } else {
                if (Math.abs(targetX - drawState.start.x) < (300/planView.zoom)) targetX = drawState.start.x;
                if (Math.abs(targetY - drawState.start.y) < (300/planView.zoom)) targetY = drawState.start.y;
            }
        }
        setDrawState(prev => ({ ...prev, current: { x: targetX, y: targetY }, snapped: snapped.isSnapToWall }));
      } 
      // Panning
      else if (planDrag.active) {
          const dx = e.clientX - planDrag.startX;
          const dy = e.clientY - planDrag.startY;
          setPlanView(prev => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
          setPlanDrag({ ...planDrag, startX: e.clientX, startY: e.clientY });
      }
      // Hover Check
      else {
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

  // --- BOM ENGINE ---
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

  // --- RENDER 3D LOOP ---
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
          f = 1; 
      } else {
          f = 4000 / (dist < 100 ? 100 : dist); 
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
      const baseColor = isSelected ? color : adjustColor(color, -60); 

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

      const faces = [
        { v: [0, 1, 2, 3], c: baseColor }, 
        { v: [5, 4, 7, 6], c: adjustColor(baseColor, -60) }, 
        { v: [4, 0, 3, 7], c: adjustColor(baseColor, -30) }, 
        { v: [1, 5, 6, 2], c: adjustColor(baseColor, -30) }, 
        { v: [3, 2, 6, 7], c: adjustColor(baseColor, 40) }, 
        { v: [4, 5, 1, 0], c: adjustColor(baseColor, -50) } 
      ];

      faces.forEach(face => {
        const minZ = Math.min(p[face.v[0]].z, p[face.v[1]].z, p[face.v[2]].z, p[face.v[3]].z);
        allFaces.push({ pts: face.v.map(i => p[i]), z: minZ, color: face.c });
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
      ctx.strokeStyle = '#00000099';
      ctx.lineWidth = 0.8;
      ctx.stroke();
    });

  }, [houseGeometry, view3D, selectedWallId, projectionMode, viewMode]);

  // --- RENDER PLAN LOOP ---
  useEffect(() => {
      if (viewMode !== 'plan') return;
      const canvas = planCanvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const width = canvas.width;
      const height = canvas.height;

      // Background Grid
      ctx.fillStyle = '#1e293b'; // Slate 800
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

      // Draw Walls
      walls.forEach(w => {
          const startX = cx + (w.position.x * planView.zoom);
          const startY = cy + (w.position.y * planView.zoom);
          const rad = w.position.rotation * (Math.PI / 180);
          const endX = startX + (Math.cos(rad) * w.length * planView.zoom);
          const endY = startY + (Math.sin(rad) * w.length * planView.zoom);
          
          const isSel = w.id === selectedWallId;
          const isHover = hoverHandle && hoverHandle.wallId === w.id;

          // Wall Line
          ctx.strokeStyle = isSel ? '#3b82f6' : '#94a3b8';
          ctx.lineWidth = 90 * planView.zoom; 
          ctx.lineCap = 'butt';
          ctx.beginPath();
          ctx.moveTo(startX, startY);
          ctx.lineTo(endX, endY);
          ctx.stroke();
          
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(startX, startY);
          ctx.lineTo(endX, endY);
          ctx.stroke();

          // Endpoints (Interactive)
          const handleSize = 5;
          ctx.fillStyle = (isHover && hoverHandle.type === 'start') ? '#22c55e' : '#fff';
          ctx.beginPath(); ctx.arc(startX, startY, handleSize, 0, Math.PI*2); ctx.fill();
          
          ctx.fillStyle = (isHover && hoverHandle.type === 'end') ? '#22c55e' : '#fff';
          ctx.beginPath(); ctx.arc(endX, endY, handleSize, 0, Math.PI*2); ctx.fill();
      });

      // Draw Drawing Preview
      if (drawState.active) {
          const cursorPos = drawState.current || { x: 0, y: 0 };
          const sx = cx + (cursorPos.x * planView.zoom);
          const sy = cy + (cursorPos.y * planView.zoom);

          ctx.strokeStyle = '#3b82f6';
          ctx.lineWidth = 1;
          const crossSize = 10;
          ctx.beginPath();
          ctx.moveTo(sx - crossSize, sy); ctx.lineTo(sx + crossSize, sy);
          ctx.moveTo(sx, sy - crossSize); ctx.lineTo(sx, sy + crossSize);
          ctx.stroke();

          if (drawState.snapped) {
              ctx.strokeStyle = '#ef4444';
              ctx.lineWidth = 2;
              ctx.beginPath(); ctx.arc(sx, sy, 8, 0, Math.PI*2); ctx.stroke();
              ctx.fillStyle = '#ef4444';
              ctx.beginPath(); ctx.arc(sx, sy, 3, 0, Math.PI*2); ctx.fill();
          }

          if (drawState.start) {
              const startScreenX = cx + (drawState.start.x * planView.zoom);
              const startScreenY = cy + (drawState.start.y * planView.zoom);
              
              ctx.strokeStyle = '#22c55e';
              ctx.lineWidth = 90 * planView.zoom;
              ctx.globalAlpha = 0.5;
              ctx.beginPath();
              ctx.moveTo(startScreenX, startScreenY);
              ctx.lineTo(sx, sy);
              ctx.stroke();
              ctx.globalAlpha = 1.0;
              
              ctx.strokeStyle = '#fff';
              ctx.lineWidth = 2;
              ctx.beginPath();
              ctx.moveTo(startScreenX, startScreenY);
              ctx.lineTo(sx, sy);
              ctx.stroke();
              
              const d = dist(drawState.start, cursorPos);
              ctx.fillStyle = '#fff';
              ctx.font = '12px monospace';
              ctx.fillText(`${Math.round(d)}mm`, (startScreenX+sx)/2, (startScreenY+sy)/2 - 10);
          }
      }

  }, [walls, viewMode, planView, selectedWallId, drawState, hoverHandle]);

  // --- HANDLERS ---
  const handleMouseDown = (e) => {
    if (viewMode === 'plan') { handlePlanMouseDown(e); return; }
    if (e.shiftKey) setIsPanning(true);
    else setIsDragging(true);
    setDragStart({ x: e.clientX, y: e.clientY });
  };

  const handleMouseMove = (e) => {
    if (viewMode === 'plan') { handlePlanMouseMove(e); return; }
    if (!isDragging && !isPanning) return;
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    setDragStart({ x: e.clientX, y: e.clientY });
    if (isPanning) setView3D(v => ({ ...v, panX: v.panX + dx, panY: v.panY + dy }));
    else setView3D(v => ({ ...v, rotY: v.rotY + dx * 0.5, rotX: Math.max(-90, Math.min(90, v.rotX - dy * 0.5)) }));
  };

  const handleExport = () => {
    // simplified export trigger
    alert("Exporting");
  };

  return (
    <div className="w-full h-screen bg-gray-950 text-gray-100 flex overflow-hidden font-sans">
      
      {/* SIDEBAR */}
      <div className={`flex-shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col transition-all ${showSettings ? 'w-80' : 'w-0 overflow-hidden'}`}>
        <div className="p-4 border-b border-gray-800 flex justify-between items-center bg-gray-900">
          <h1 className="font-bold flex items-center gap-2"><Home className="w-5 h-5 text-blue-500" /> House Builder</h1>
          <div className="flex gap-1 bg-gray-800 rounded p-1">
             <button onClick={() => setActiveTab('walls')} className={`px-2 py-1 text-xs rounded ${activeTab==='walls'?'bg-blue-600':'hover:bg-gray-700'}`}>Layout</button>
             <button onClick={() => setActiveTab('editor')} className={`px-2 py-1 text-xs rounded ${activeTab==='editor'?'bg-blue-600':'hover:bg-gray-700'}`}>Edit</button>
             <button onClick={() => setActiveTab('bom')} className={`px-2 py-1 text-xs rounded ${activeTab==='bom'?'bg-blue-600':'hover:bg-gray-700'}`}>BOM</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          
          {/* --- TAB: WALL LIST --- */}
          {activeTab === 'walls' && (
            <div className="space-y-4">
               
               <div className="bg-gray-800 rounded p-3 border border-gray-700">
                  <h3 className="text-xs font-bold text-gray-400 uppercase mb-2 flex items-center gap-1"><PenTool className="w-3 h-3"/> Tools</h3>
                  <div className="flex gap-2">
                     <button onClick={() => { setViewMode('plan'); setDrawState(s => ({...s, active: !s.active, start: null})); }} 
                             className={`flex-1 p-2 rounded text-xs text-center border transition flex items-center justify-center gap-2 ${drawState.active ? 'bg-green-600 border-green-500 text-white' : 'bg-gray-700 border-gray-600 hover:bg-gray-600'}`}>
                        {drawState.active ? 'Drawing... (Esc to Cancel, Shift for Ortho)' : 'Draw Wall'}
                     </button>
                  </div>
                  <div className="text-[10px] text-gray-500 mt-2">
                     {drawState.active ? "Click in Plan View to start wall. Click again to finish." : "Switch to Plan View to draw walls easily."}
                  </div>
               </div>

               <div className="flex justify-between items-center pt-2 border-t border-gray-800">
                 <h3 className="text-xs font-bold text-gray-500 uppercase">Wall List</h3>
               </div>
               <div className="space-y-2">
                 {walls.map(w => (
                   <div key={w.id} 
                        onClick={() => { setSelectedWallId(w.id); setActiveTab('editor'); }}
                        className={`p-3 rounded border cursor-pointer transition-all flex justify-between items-center ${selectedWallId === w.id ? 'bg-blue-900/40 border-blue-500 ring-1 ring-blue-500' : 'bg-gray-800 border-gray-700 hover:bg-gray-750'}`}>
                      <div>
                        <div className="font-semibold text-sm text-gray-200">{w.name}</div>
                        <div className="text-[10px] text-gray-400">{w.length}mm</div>
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
           
           {/* VIEW TABS */}
           <div className="bg-gray-900 rounded p-1 flex gap-1 border border-gray-700">
              <button onClick={() => setViewMode('plan')} className={`px-3 py-1 rounded text-xs font-bold ${viewMode==='plan'?'bg-blue-600 text-white':'text-gray-400 hover:text-white'}`}>2D Plan</button>
              <button onClick={() => setViewMode('3d')} className={`px-3 py-1 rounded text-xs font-bold ${viewMode==='3d'?'bg-blue-600 text-white':'text-gray-400 hover:text-white'}`}>3D Model</button>
           </div>

           {viewMode === '3d' && (
             <button onClick={() => setProjectionMode(m => m === 'perspective' ? 'orthographic' : 'perspective')} 
                     className={`p-2 rounded shadow border border-gray-600 text-white transition ${projectionMode === 'orthographic' ? 'bg-blue-600' : 'bg-gray-800 hover:bg-gray-700'}`}
                     title="Toggle Ortho/Persp">
                {projectionMode === 'perspective' ? <Box className="w-4 h-4" /> : <Grid className="w-4 h-4" />}
             </button>
           )}

           <button onClick={() => setView3D(DEFAULT_VIEW)} className="bg-gray-800 hover:bg-gray-700 text-white p-2 rounded shadow border border-gray-600"><RotateCw className="w-4 h-4"/></button>
           <button onClick={handleExport} className="bg-blue-600 hover:bg-blue-500 text-white p-2 rounded shadow flex items-center gap-2 text-sm font-semibold pr-4"><Download className="w-4 h-4"/> Export House</button>
        </div>
        
        {/* Zoom Controls Overlay for Plan Mode */}
        {viewMode === 'plan' && (
            <div className="absolute bottom-12 right-4 flex flex-col gap-2 z-10">
                <button onClick={() => setPlanView(p => ({...p, zoom: Math.min(p.zoom * 1.2, 5)}))} className="bg-gray-800 p-2 rounded hover:bg-gray-700 border border-gray-600 text-white">
                    <ZoomIn className="w-4 h-4" />
                </button>
                <button onClick={() => setPlanView(p => ({...p, zoom: Math.max(p.zoom / 1.2, 0.1)}))} className="bg-gray-800 p-2 rounded hover:bg-gray-700 border border-gray-600 text-white">
                    <ZoomOut className="w-4 h-4" />
                </button>
            </div>
        )}

        {!showSettings && <button onClick={() => setShowSettings(true)} className="absolute top-4 left-4 bg-gray-800 p-2 rounded text-white z-10"><Settings className="w-4 h-4"/></button>}
        {showSettings && <button onClick={() => setShowSettings(false)} className="absolute top-4 left-[340px] bg-gray-800 p-2 rounded-r text-gray-400 z-10 border-y border-r border-gray-700"><X className="w-3 h-3"/></button>}
        
        {viewMode === 'plan' ? (
            <canvas ref={planCanvasRef} width={1600} height={1200} className="w-full h-full cursor-crosshair block"
              onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handlePlanMouseUp} onMouseLeave={handlePlanMouseUp} onWheel={handlePlanWheel}
            />
        ) : (
            <canvas ref={canvasRef} width={1600} height={1200} className="w-full h-full cursor-move block"
              onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={() => { setIsDragging(false); setIsPanning(false); }} onMouseLeave={() => { setIsDragging(false); setIsPanning(false); }}
              onWheel={(e) => setView3D(v => ({...v, zoom: Math.max(0.1, v.zoom - e.deltaY * 0.001)}))}
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
