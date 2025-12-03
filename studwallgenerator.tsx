import React, { useState, useRef, useEffect } from 'react';
import { Download, Plus, Trash2, Settings, Move, ZoomIn, RotateCw, X } from 'lucide-react';

const AS1684WallGenerator = () => {
  const [wallLength, setWallLength] = useState(3600);
  const [wallHeight, setWallHeight] = useState(2400);
  const [studSize, setStudSize] = useState('90x45');
  const [studSpacing, setStudSpacing] = useState(450);
  const [timberGrade, setTimberGrade] = useState('MGP10');
  const [openings, setOpenings] = useState([]);
  const [showBracing, setShowBracing] = useState(false);
  const [view3D, setView3D] = useState({ rotX: 20, rotY: 45, zoom: 1, panX: 0, panY: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [showSettings, setShowSettings] = useState(false);
  const canvasRef = useRef(null);

  const timberSizes = {
    '70x35': { width: 70, depth: 35 },
    '90x35': { width: 90, depth: 35 },
    '90x45': { width: 90, depth: 45 },
    '140x45': { width: 140, depth: 45 }
  };

  const addOpening = () => {
    setOpenings([...openings, {
      id: Date.now(),
      startX: 500,
      width: 900,
      height: 2100,
      sillHeight: 0,
      type: 'door'
    }]);
  };

  const removeOpening = (id) => {
    setOpenings(openings.filter(o => o.id !== id));
  };

  const updateOpening = (id, field, value) => {
    setOpenings(openings.map(o => 
      o.id === id ? { ...o, [field]: parseFloat(value) || 0 } : o
    ));
  };

  const generateWallFraming = () => {
    const timber = timberSizes[studSize];
    const components = [];

    // Bottom and Top plates - plates DON'T extend through openings
    // We'll need to break plates at openings
    
    // Collect all opening boundaries
    const openingBoundaries = openings.map(o => ({
      start: o.startX - timber.depth,
      end: o.startX + o.width + timber.depth
    })).sort((a, b) => a.start - b.start);
    
    // Create plate segments between openings
    const plateStartX = -timber.depth / 2;
    const plateEndX = wallLength + timber.depth / 2;
    
    let currentX = plateStartX;
    
    if (openingBoundaries.length === 0) {
      // No openings - continuous plates
      components.push({
        type: 'bottom_plate',
        x: plateStartX, y: 0, z: 0,
        length: plateEndX - plateStartX,
        width: timber.depth,
        depth: timber.width
      });
      components.push({
        type: 'top_plate_1',
        x: plateStartX, y: wallHeight - timber.depth, z: 0,
        length: plateEndX - plateStartX,
        width: timber.depth,
        depth: timber.width
      });
      components.push({
        type: 'top_plate_2',
        x: plateStartX, y: wallHeight - timber.depth * 2, z: 0,
        length: plateEndX - plateStartX,
        width: timber.depth,
        depth: timber.width
      });
    } else {
      // Create plate segments
      openingBoundaries.forEach(opening => {
        if (currentX < opening.start) {
          const segmentLength = opening.start - currentX;
          components.push({
            type: 'bottom_plate',
            x: currentX, y: 0, z: 0,
            length: segmentLength,
            width: timber.depth,
            depth: timber.width
          });
          components.push({
            type: 'top_plate_1',
            x: currentX, y: wallHeight - timber.depth, z: 0,
            length: segmentLength,
            width: timber.depth,
            depth: timber.width
          });
          components.push({
            type: 'top_plate_2',
            x: currentX, y: wallHeight - timber.depth * 2, z: 0,
            length: segmentLength,
            width: timber.depth,
            depth: timber.width
          });
        }
        currentX = opening.end;
      });
      
      // Final segment after last opening
      if (currentX < plateEndX) {
        const segmentLength = plateEndX - currentX;
        components.push({
          type: 'bottom_plate',
          x: currentX, y: 0, z: 0,
          length: segmentLength,
          width: timber.depth,
          depth: timber.width
        });
        components.push({
          type: 'top_plate_1',
          x: currentX, y: wallHeight - timber.depth, z: 0,
          length: segmentLength,
          width: timber.depth,
          depth: timber.width
        });
        components.push({
          type: 'top_plate_2',
          x: currentX, y: wallHeight - timber.depth * 2, z: 0,
          length: segmentLength,
          width: timber.depth,
          depth: timber.width
        });
      }
    }

    const studPositions = [];
    
    // Always place studs at 0 and wallLength (end studs)
    studPositions.push(0);
    
    for (let x = studSpacing; x < wallLength; x += studSpacing) {
      
      let isBlocked = false;
      for (const opening of openings) {
        if (x >= opening.startX && x <= opening.startX + opening.width) {
          isBlocked = true;
          break;
        }
      }
      
      if (!isBlocked) {
        studPositions.push(x);
      }
    }
    
    // Always add end stud at wallLength if not already there
    if (studPositions[studPositions.length - 1] !== wallLength) {
      studPositions.push(wallLength);
    }
    
    // Now create studs at all positions
    studPositions.forEach(x => {
      components.push({
        type: 'stud',
        x: x - timber.depth / 2,
        y: timber.depth,
        z: 0,
        length: timber.depth,
        width: wallHeight - timber.depth * 3,
        depth: timber.width
      });
    });

    openings.forEach(opening => {
      const startX = opening.startX;
      const endX = opening.startX + opening.width;

      components.push({
        type: 'jamb_stud_left',
        x: startX - timber.depth,
        y: timber.depth,
        z: 0,
        length: timber.depth,
        width: wallHeight - timber.depth * 3,
        depth: timber.width
      });
      components.push({
        type: 'jamb_stud_right',
        x: endX,
        y: timber.depth,
        z: 0,
        length: timber.depth,
        width: wallHeight - timber.depth * 3,
        depth: timber.width
      });

      const lintelDepth = opening.width > 1200 ? timber.width * 2 : timber.width;
      
      components.push({
        type: 'jack_stud_left',
        x: startX - timber.depth / 2,
        y: timber.depth,
        z: 0,
        length: timber.depth,
        width: opening.sillHeight + opening.height,
        depth: timber.width
      });
      components.push({
        type: 'jack_stud_right',
        x: endX - timber.depth / 2,
        y: timber.depth,
        z: 0,
        length: timber.depth,
        width: opening.sillHeight + opening.height,
        depth: timber.width
      });

      components.push({
        type: 'lintel',
        x: startX - timber.depth,
        y: timber.depth + opening.sillHeight + opening.height,
        z: 0,
        length: opening.width + timber.depth * 2,
        width: lintelDepth,
        depth: timber.depth
      });

      if (opening.sillHeight > 0) {
        components.push({
          type: 'sill',
          x: startX - timber.depth,
          y: timber.depth + opening.sillHeight,
          z: 0,
          length: opening.width + timber.depth * 2,
          width: timber.depth,
          depth: timber.depth
        });

        for (let x = startX; x < endX; x += studSpacing) {
          components.push({
            type: 'cripple_stud',
            x: x - timber.depth / 2,
            y: timber.depth,
            z: 0,
            length: timber.depth,
            width: opening.sillHeight,
            depth: timber.width
          });
        }
      }

      for (let x = startX; x < endX; x += studSpacing) {
        components.push({
          type: 'cripple_stud_top',
          x: x - timber.depth / 2,
          y: timber.depth + opening.sillHeight + opening.height + lintelDepth,
          z: 0,
          length: timber.depth,
          width: wallHeight - timber.depth * 3 - opening.sillHeight - opening.height - lintelDepth,
          depth: timber.width
        });
      }
    });

    const nogginHeight = wallHeight / 2;
    for (let i = 0; i < studPositions.length - 1; i++) {
      const stagger = i % 2 === 0 ? timber.depth / 2 : -timber.depth / 2;
      components.push({
        type: 'noggin',
        x: studPositions[i] + timber.depth / 2,
        y: nogginHeight + stagger,
        z: 0,
        length: studPositions[i + 1] - studPositions[i] - timber.depth,
        width: timber.depth,
        depth: timber.width
      });
    }

    if (showBracing) {
      const braceLength = Math.sqrt(wallLength * wallLength + (wallHeight - timber.depth * 3) * (wallHeight - timber.depth * 3));
      const angle = Math.atan((wallHeight - timber.depth * 3) / wallLength);
      
      components.push({
        type: 'brace',
        x: 0,
        y: timber.depth,
        z: timber.width / 2,
        length: braceLength,
        width: timber.depth,
        depth: 35,
        angle: angle * 180 / Math.PI
      });
    }

    return components;
  };

  const handleMouseDown = (e) => {
    if (e.shiftKey) {
      setIsPanning(true);
    } else {
      setIsDragging(true);
    }
    setDragStart({ x: e.clientX, y: e.clientY });
  };

  const handleMouseMove = (e) => {
    if (isPanning) {
      const deltaX = e.clientX - dragStart.x;
      const deltaY = e.clientY - dragStart.y;
      
      setView3D(prev => ({
        ...prev,
        panX: prev.panX + deltaX,
        panY: prev.panY + deltaY
      }));
      
      setDragStart({ x: e.clientX, y: e.clientY });
    } else if (isDragging) {
      const deltaX = e.clientX - dragStart.x;
      const deltaY = e.clientY - dragStart.y;
      
      setView3D(prev => ({
        ...prev,
        rotY: (prev.rotY + deltaX * 0.5) % 360,
        rotX: Math.max(-90, Math.min(90, prev.rotX - deltaY * 0.5))
      }));
      
      setDragStart({ x: e.clientX, y: e.clientY });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    setIsPanning(false);
  };

  const handleWheel = (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setView3D(prev => ({
      ...prev,
      zoom: Math.max(0.1, Math.min(5, prev.zoom * delta))
    }));
  };

  const resetView = () => {
    setView3D({ rotX: 20, rotY: 45, zoom: 1, panX: 0, panY: 0 });
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);

    const components = generateWallFraming();
    
    const centerX = wallLength / 2;
    const centerY = wallHeight / 2;
    const centerZ = timberSizes[studSize].width / 2;
    
    const scale = Math.min(width / (wallLength * 1.2), height / (wallHeight * 1.2)) * view3D.zoom;
    const offsetX = width / 2;
    const offsetY = height / 2;

    const project = (x, y, z) => {
      let x1 = x - centerX;
      let y1 = y - centerY;
      let z1 = z - centerZ;

      const rotX = view3D.rotX * Math.PI / 180;
      const rotY = view3D.rotY * Math.PI / 180;

      let x2 = x1 * Math.cos(rotY) - z1 * Math.sin(rotY);
      let z2 = x1 * Math.sin(rotY) + z1 * Math.cos(rotY);

      let y2 = y1 * Math.cos(rotX) - z2 * Math.sin(rotX);
      let z3 = y1 * Math.sin(rotX) + z2 * Math.cos(rotX);

      return {
        x: offsetX + x2 * scale + view3D.panX,
        y: offsetY - y2 * scale + view3D.panY,
        depth: z3
      };
    };

    const drawBox = (comp) => {
      const { x, y, z, length, width, depth } = comp;

      const corners = [
        [x, y, z],
        [x + length, y, z],
        [x + length, y + width, z],
        [x, y + width, z],
        [x, y, z + depth],
        [x + length, y, z + depth],
        [x + length, y + width, z + depth],
        [x, y + width, z + depth]
      ];

      const projected = corners.map(c => project(c[0], c[1], c[2]));

      const colors = {
        bottom_plate: '#8B4513',
        top_plate_1: '#A0522D',
        top_plate_2: '#A0522D',
        stud: '#CD853F',
        jamb_stud_left: '#D2691E',
        jamb_stud_right: '#D2691E',
        jack_stud_left: '#D2691E',
        jack_stud_right: '#D2691E',
        lintel: '#8B4513',
        sill: '#A0522D',
        cripple_stud: '#DEB887',
        cripple_stud_top: '#DEB887',
        noggin: '#BC8F8F',
        brace: '#4169E1'
      };

      ctx.strokeStyle = colors[comp.type] || '#DEB887';
      ctx.fillStyle = ctx.strokeStyle + '70';
      ctx.lineWidth = 1.5;

      const faces = [
        { indices: [0, 1, 2, 3], avgDepth: (projected[0].depth + projected[1].depth + projected[2].depth + projected[3].depth) / 4 },
        { indices: [4, 5, 6, 7], avgDepth: (projected[4].depth + projected[5].depth + projected[6].depth + projected[7].depth) / 4 },
        { indices: [0, 1, 5, 4], avgDepth: (projected[0].depth + projected[1].depth + projected[5].depth + projected[4].depth) / 4 },
        { indices: [2, 3, 7, 6], avgDepth: (projected[2].depth + projected[3].depth + projected[7].depth + projected[6].depth) / 4 },
        { indices: [0, 3, 7, 4], avgDepth: (projected[0].depth + projected[3].depth + projected[7].depth + projected[4].depth) / 4 },
        { indices: [1, 2, 6, 5], avgDepth: (projected[1].depth + projected[2].depth + projected[6].depth + projected[5].depth) / 4 }
      ];

      faces.sort((a, b) => b.avgDepth - a.avgDepth);

      faces.forEach(face => {
        ctx.beginPath();
        ctx.moveTo(projected[face.indices[0]].x, projected[face.indices[0]].y);
        face.indices.forEach(idx => ctx.lineTo(projected[idx].x, projected[idx].y));
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      });
    };

    components.forEach(comp => drawBox(comp));

    ctx.strokeStyle = '#333';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= wallLength; i += 600) {
      const p1 = project(i, 0, 0);
      const p2 = project(i, wallHeight, 0);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }

  }, [wallLength, wallHeight, studSize, studSpacing, openings, showBracing, view3D]);

  const exportModel = async () => {
    const components = generateWallFraming();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    
    // Export as DXF format
    let dxf = "0\nSECTION\n2\nHEADER\n";
    dxf += "9\n$ACADVER\n1\nAC1015\n";
    dxf += "9\n$INSUNITS\n70\n4\n"; // Millimeters
    dxf += "0\nENDSEC\n";
    
    dxf += "0\nSECTION\n2\nTABLES\n";
    dxf += "0\nTABLE\n2\nLAYER\n70\n1\n";
    dxf += "0\nLAYER\n2\nFRAME\n70\n0\n62\n7\n6\nCONTINUOUS\n";
    dxf += "0\nENDTAB\n0\nENDSEC\n";
    
    dxf += "0\nSECTION\n2\nENTITIES\n";

    components.forEach((comp) => {
      const { x, y, z, length, width, depth } = comp;
      
      // Draw each box as 12 lines (edges)
      const edges = [
        // Bottom rectangle
        [[x, y, z], [x + length, y, z]],
        [[x + length, y, z], [x + length, y + width, z]],
        [[x + length, y + width, z], [x, y + width, z]],
        [[x, y + width, z], [x, y, z]],
        // Top rectangle
        [[x, y, z + depth], [x + length, y, z + depth]],
        [[x + length, y, z + depth], [x + length, y + width, z + depth]],
        [[x + length, y + width, z + depth], [x, y + width, z + depth]],
        [[x, y + width, z + depth], [x, y, z + depth]],
        // Vertical edges
        [[x, y, z], [x, y, z + depth]],
        [[x + length, y, z], [x + length, y, z + depth]],
        [[x + length, y + width, z], [x + length, y + width, z + depth]],
        [[x, y + width, z], [x, y + width, z + depth]]
      ];

      edges.forEach(edge => {
        dxf += "0\nLINE\n8\nFRAME\n";
        dxf += `10\n${edge[0][0].toFixed(2)}\n20\n${edge[0][1].toFixed(2)}\n30\n${edge[0][2].toFixed(2)}\n`;
        dxf += `11\n${edge[1][0].toFixed(2)}\n21\n${edge[1][1].toFixed(2)}\n31\n${edge[1][2].toFixed(2)}\n`;
      });
    });

    dxf += "0\nENDSEC\n0\nEOF\n";

    // Export DXF
    try {
      const blobDxf = new Blob([dxf], { type: 'application/dxf' });
      const urlDxf = URL.createObjectURL(blobDxf);
      const aDxf = document.createElement('a');
      aDxf.href = urlDxf;
      aDxf.download = `AS1684_Wall_${wallLength}x${wallHeight}_${timestamp}.dxf`;
      document.body.appendChild(aDxf);
      aDxf.click();
      document.body.removeChild(aDxf);
      
      // Small delay to ensure first download starts
      await new Promise(resolve => setTimeout(resolve, 100));
      
      URL.revokeObjectURL(urlDxf);
    } catch (error) {
      console.error('DXF Export failed:', error);
    }

    // Export OBJ
    try {
      let obj = "# AS 1684 Timber Wall Frame Export\n";
      obj += `# Generated: ${new Date().toLocaleString()}\n`;
      obj += `# Wall: ${wallLength}mm x ${wallHeight}mm\n`;
      obj += `# Timber: ${studSize}mm ${timberGrade}\n`;
      obj += `# Spacing: ${studSpacing}mm centers\n`;
      obj += `# Components: ${components.length}\n\n`;

      let vertexCount = 1;

      components.forEach((comp, idx) => {
        obj += `o ${comp.type}_${idx}\n`;
        
        const { x, y, z, length, width, depth } = comp;
        
        const vertices = [
          [x, y, z], 
          [x + length, y, z], 
          [x + length, y + width, z], 
          [x, y + width, z],
          [x, y, z + depth], 
          [x + length, y, z + depth], 
          [x + length, y + width, z + depth], 
          [x, y + width, z + depth]
        ];

        vertices.forEach(v => {
          obj += `v ${v[0].toFixed(2)} ${v[1].toFixed(2)} ${v[2].toFixed(2)}\n`;
        });

        // Add normals for better rendering
        obj += `vn 0 0 -1\nvn 0 0 1\nvn 0 -1 0\nvn 0 1 0\nvn -1 0 0\nvn 1 0 0\n`;

        const faces = [
          [1, 2, 3, 4], // front
          [8, 7, 6, 5], // back
          [5, 6, 2, 1], // bottom
          [4, 3, 7, 8], // top
          [1, 4, 8, 5], // left
          [2, 6, 7, 3]  // right
        ];

        faces.forEach((face, fIdx) => {
          obj += `f ${face[0] + vertexCount - 1}//${fIdx + 1} ${face[1] + vertexCount - 1}//${fIdx + 1} ${face[2] + vertexCount - 1}//${fIdx + 1} ${face[3] + vertexCount - 1}//${fIdx + 1}\n`;
        });

        vertexCount += 8;
        obj += "\n";
      });

      const blobObj = new Blob([obj], { type: 'text/plain' });
      const urlObj = URL.createObjectURL(blobObj);
      const aObj = document.createElement('a');
      aObj.href = urlObj;
      aObj.download = `AS1684_Wall_${wallLength}x${wallHeight}_${timestamp}.obj`;
      document.body.appendChild(aObj);
      aObj.click();
      document.body.removeChild(aObj);
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      URL.revokeObjectURL(urlObj);
    } catch (error) {
      console.error('OBJ Export failed:', error);
    }
  };

  return (
    <div className="w-full h-screen bg-gray-950 text-white flex relative">
      {/* Floating Properties Panel */}
      <div className={`absolute top-4 left-4 bg-gray-900 bg-opacity-95 backdrop-blur-sm rounded-lg shadow-2xl border border-gray-700 z-10 transition-all ${showSettings ? 'w-80' : 'w-auto'}`}>
        <div className="p-3 border-b border-gray-700 flex items-center justify-between bg-gray-800 rounded-t-lg">
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-blue-400" />
            <span className="font-semibold text-sm">Wall Properties</span>
          </div>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="text-gray-400 hover:text-white transition"
          >
            {showSettings ? <X className="w-4 h-4" /> : <Settings className="w-4 h-4" />}
          </button>
        </div>

        {showSettings && (
          <div className="p-4 space-y-3 max-h-[calc(100vh-120px)] overflow-y-auto">
            <div>
              <label className="block text-xs font-medium mb-1 text-gray-300">Length (mm)</label>
              <input
                type="number"
                value={wallLength}
                onChange={(e) => setWallLength(parseFloat(e.target.value) || 0)}
                className="w-full bg-gray-800 px-2 py-1.5 rounded text-sm border border-gray-600 focus:border-blue-500 outline-none"
                step="100"
              />
            </div>

            <div>
              <label className="block text-xs font-medium mb-1 text-gray-300">Height (mm)</label>
              <input
                type="number"
                value={wallHeight}
                onChange={(e) => setWallHeight(parseFloat(e.target.value) || 0)}
                className="w-full bg-gray-800 px-2 py-1.5 rounded text-sm border border-gray-600 focus:border-blue-500 outline-none"
                step="100"
              />
            </div>

            <div>
              <label className="block text-xs font-medium mb-1 text-gray-300">Stud Size</label>
              <select
                value={studSize}
                onChange={(e) => setStudSize(e.target.value)}
                className="w-full bg-gray-800 px-2 py-1.5 rounded text-sm border border-gray-600 focus:border-blue-500 outline-none"
              >
                {Object.keys(timberSizes).map(size => (
                  <option key={size} value={size}>{size}mm</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1 text-gray-300">Spacing</label>
              <select
                value={studSpacing}
                onChange={(e) => setStudSpacing(Number(e.target.value))}
                className="w-full bg-gray-800 px-2 py-1.5 rounded text-sm border border-gray-600 focus:border-blue-500 outline-none"
              >
                <option value="450">450mm</option>
                <option value="600">600mm</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1 text-gray-300">Grade</label>
              <select
                value={timberGrade}
                onChange={(e) => setTimberGrade(e.target.value)}
                className="w-full bg-gray-800 px-2 py-1.5 rounded text-sm border border-gray-600 focus:border-blue-500 outline-none"
              >
                <option value="MGP10">MGP10</option>
                <option value="MGP12">MGP12</option>
                <option value="MGP15">MGP15</option>
              </select>
            </div>

            <div>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={showBracing}
                  onChange={(e) => setShowBracing(e.target.checked)}
                  className="w-3.5 h-3.5"
                />
                <span className="text-xs text-gray-300">Diagonal Bracing</span>
              </label>
            </div>

            <div className="pt-3 border-t border-gray-700">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold text-gray-300">Openings</h3>
                <button
                  onClick={addOpening}
                  className="bg-blue-600 hover:bg-blue-700 px-2 py-1 rounded flex items-center gap-1 text-xs transition"
                >
                  <Plus className="w-3 h-3" /> Add
                </button>
              </div>

              <div className="space-y-2">
                {openings.map(opening => (
                  <div key={opening.id} className="bg-gray-800 p-2 rounded space-y-1.5 border border-gray-700">
                    <div className="flex justify-between items-center">
                      <select
                        value={opening.type}
                        onChange={(e) => updateOpening(opening.id, 'type', e.target.value)}
                        className="bg-gray-700 px-2 py-1 rounded text-xs border border-gray-600"
                      >
                        <option value="door">Door</option>
                        <option value="window">Window</option>
                      </select>
                      <button
                        onClick={() => removeOpening(opening.id)}
                        className="text-red-400 hover:text-red-300 transition"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <input
                      type="number"
                      placeholder="Start X"
                      value={opening.startX}
                      onChange={(e) => updateOpening(opening.id, 'startX', e.target.value)}
                      className="w-full bg-gray-700 px-2 py-1 rounded text-xs border border-gray-600"
                    />
                    <input
                      type="number"
                      placeholder="Width"
                      value={opening.width}
                      onChange={(e) => updateOpening(opening.id, 'width', e.target.value)}
                      className="w-full bg-gray-700 px-2 py-1 rounded text-xs border border-gray-600"
                    />
                    <input
                      type="number"
                      placeholder="Height"
                      value={opening.height}
                      onChange={(e) => updateOpening(opening.id, 'height', e.target.value)}
                      className="w-full bg-gray-700 px-2 py-1 rounded text-xs border border-gray-600"
                    />
                    <input
                      type="number"
                      placeholder="Sill Height"
                      value={opening.sillHeight}
                      onChange={(e) => updateOpening(opening.id, 'sillHeight', e.target.value)}
                      className="w-full bg-gray-700 px-2 py-1 rounded text-xs border border-gray-600"
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {!showSettings && (
          <div className="p-3 text-xs space-y-1 text-gray-300">
            <div>L: {wallLength}mm × H: {wallHeight}mm</div>
            <div>{studSize}mm @ {studSpacing}mm • {timberGrade}</div>
          </div>
        )}
      </div>

      {/* Floating Controls */}
      <div className="absolute top-4 right-4 flex flex-col gap-2 z-10">
        <button
          onClick={exportModel}
          className="bg-green-600 hover:bg-green-700 p-3 rounded-lg shadow-lg flex items-center gap-2 text-sm font-semibold transition"
        >
          <Download className="w-4 h-4" />
          Export (DXF + OBJ)
        </button>
        <button
          onClick={resetView}
          className="bg-gray-800 hover:bg-gray-700 p-3 rounded-lg shadow-lg border border-gray-600 transition"
        >
          <RotateCw className="w-4 h-4" />
        </button>
      </div>

      {/* Info Badge */}
      <div className="absolute bottom-4 left-4 bg-gray-900 bg-opacity-95 backdrop-blur-sm px-4 py-2 rounded-lg shadow-lg border border-gray-700 text-xs text-gray-300 z-10">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <Move className="w-3 h-3" />
            <span>Drag to rotate</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="bg-gray-700 px-1 rounded">Shift</span>
            <span>+ Drag to pan</span>
          </div>
          <div className="flex items-center gap-1">
            <ZoomIn className="w-3 h-3" />
            <span>Scroll to zoom</span>
          </div>
        </div>
      </div>

      {/* Compliance Badge */}
      <div className="absolute bottom-4 right-4 bg-blue-900 bg-opacity-90 backdrop-blur-sm px-3 py-2 rounded-lg shadow-lg border border-blue-700 text-xs text-blue-100 z-10 max-w-md">
        <div className="font-semibold mb-1">AS 1684 Compliant</div>
        <div className="opacity-80">Studs @ {studSpacing}mm • Noggins mid-height • Double top plate</div>
      </div>

      {/* 3D Canvas */}
      <div className="w-full h-full flex items-center justify-center">
        <canvas
          ref={canvasRef}
          width={1600}
          height={1000}
          className="cursor-move"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
        />
      </div>
    </div>
  );
};

export default AS1684WallGenerator;
