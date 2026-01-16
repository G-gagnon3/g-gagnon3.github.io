import React, { useState, useEffect, useRef } from 'react';
import { 
  Circle, 
  Pen, 
  Minus, 
  RotateCcw, 
  Trash2, 
  Download, 
  Hand, 
  Eraser, 
  User,
  X,
  Check,
  RectangleHorizontal,
  RectangleVertical
} from 'lucide-react';

const LacrosseBoard = () => {
  // State
  const [tool, setTool] = useState('player'); // player, circle, line, freehand, interact, eraser
  const [viewMode, setViewMode] = useState('full'); // 'full' | 'half'
  const [color, setColor] = useState('#ef4444'); // default red
  const [elements, setElements] = useState([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentElement, setCurrentElement] = useState(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  
  // Interaction State
  const [selectedElementIds, setSelectedElementIds] = useState([]); // Multiple items
  const [dragLastPos, setDragLastPos] = useState(null); // For delta movement
  const [selectionBox, setSelectionBox] = useState(null); // { startX, startY, currentX, currentY }
  
  // Canvas refs
  const canvasRef = useRef(null);
  const containerRef = useRef(null);

  // Field Constants
  const FIELD_COLOR = '#ffffff'; // Whiteboard style
  const LINE_COLOR = '#000000';  // Black lines
  
  // Utility: Generate ID
  const generateId = () => Date.now().toString(36) + Math.random().toString(36).substr(2);

  // --- Geometry / Hit Testing ---

  const distance = (a, b) => Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2));

  const pointToLineDistance = (point, start, end) => {
    const A = point.x - start.x;
    const B = point.y - start.y;
    const C = end.x - start.x;
    const D = end.y - start.y;

    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = -1;
    if (lenSq !== 0) // in case of 0 length line
        param = dot / lenSq;

    let xx, yy;

    if (param < 0) {
      xx = start.x;
      yy = start.y;
    }
    else if (param > 1) {
      xx = end.x;
      yy = end.y;
    }
    else {
      xx = start.x + param * C;
      yy = start.y + param * D;
    }

    const dx = point.x - xx;
    const dy = point.y - yy;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const isHit = (element, x, y) => {
    const threshold = 10; // Pixel tolerance
    if (element.type === 'player') {
      const dist = distance({x, y}, {x: element.x, y: element.y});
      return dist <= element.radius + 5;
    }
    if (element.type === 'circle') {
      const dist = distance({x, y}, {x: element.sx, y: element.sy});
      // Hit if inside the circle
      const r = Math.max(distance({x: element.sx, y: element.sy}, {x: element.ex, y: element.ey}), 10);
      return dist <= r;
    }
    if (element.type === 'line') {
      return pointToLineDistance({x, y}, {x: element.sx, y: element.sy}, {x: element.ex, y: element.ey}) < threshold;
    }
    if (element.type === 'freehand') {
      // Check distance to any point in the path (simplified)
      return element.points.some(p => distance({x, y}, p) < threshold);
    }
    return false;
  };

  // Helper to check if element is inside selection box
  const isElementInRect = (element, rect) => {
    const { x, y, w, h } = rect;
    
    if (element.type === 'player') {
        return element.x >= x && element.x <= x + w && element.y >= y && element.y <= y + h;
    }
    if (element.type === 'line' || element.type === 'circle') {
        // Check if start or end is in box (simple approximation)
        const sIn = element.sx >= x && element.sx <= x + w && element.sy >= y && element.sy <= y + h;
        const eIn = element.ex >= x && element.ex <= x + w && element.ey >= y && element.ey <= y + h;
        return sIn || eIn;
    }
    if (element.type === 'freehand') {
        // Check if any point is in box
        return element.points.some(p => p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h);
    }
    return false;
  };

  const getElementAtPosition = (x, y) => {
    // Iterate in reverse to grab top-most element
    for (let i = elements.length - 1; i >= 0; i--) {
      if (isHit(elements[i], x, y)) {
        return elements[i];
      }
    }
    return null;
  };

  // --- Drawing Logic ---

  const drawFullField = (ctx, x, y, w, h, scale) => {
    // Outer Boundary (Sidelines & Endlines)
    ctx.strokeRect(x, y, w, h);

    // Midfield Line
    ctx.beginPath();
    ctx.moveTo(x + w / 2, y);
    ctx.lineTo(x + w / 2, y + h);
    ctx.stroke();

    // Center Circle (Radius 5 yards approx for drawing)
    ctx.beginPath();
    ctx.arc(x + w / 2, y + h / 2, Math.max(0, 5 * scale), 0, Math.PI * 2);
    ctx.stroke();
    // Center X
    const xSize = 2 * scale;
    ctx.beginPath();
    ctx.moveTo(x + w/2 - xSize, y + h/2 - xSize);
    ctx.lineTo(x + w/2 + xSize, y + h/2 + xSize);
    ctx.moveTo(x + w/2 + xSize, y + h/2 - xSize);
    ctx.lineTo(x + w/2 - xSize, y + h/2 + xSize);
    ctx.stroke();

    // Restraining Lines (35 yards from each end line)
    const restrainDist = 35 * scale;
    // Left Restraining Line
    ctx.beginPath();
    ctx.moveTo(x + restrainDist, y);
    ctx.lineTo(x + restrainDist, y + h);
    ctx.stroke();
    // Right Restraining Line
    ctx.beginPath();
    ctx.moveTo(x + w - restrainDist, y);
    ctx.lineTo(x + w - restrainDist, y + h);
    ctx.stroke();

    // Goal Areas / Creases (Goals are 15 yards from end lines)
    const goalDist = 15 * scale;
    const creaseRadius = Math.max(0, 3 * scale); 
    
    // Left Goal Crease
    const leftGoalX = x + goalDist;
    const centerY = y + h / 2;
    
    ctx.beginPath();
    ctx.arc(leftGoalX, centerY, creaseRadius, 0, Math.PI * 2);
    ctx.fillStyle = '#e5e7eb'; // light gray fill
    ctx.fill();
    ctx.stroke();
    // Goal Line Marker
    ctx.fillStyle = LINE_COLOR;
    ctx.fillRect(leftGoalX, centerY - (3 * scale), 2, 6 * scale); 

    // Right Goal Crease
    const rightGoalX = x + w - goalDist;
    
    ctx.beginPath();
    ctx.arc(rightGoalX, centerY, creaseRadius, 0, Math.PI * 2);
    ctx.fillStyle = '#e5e7eb';
    ctx.fill();
    ctx.stroke();
    // Goal Line Marker
    ctx.fillRect(rightGoalX, centerY - (3 * scale), 2, 6 * scale);

    // Wing Lines (10 yards from sideline, 20 yards long centered on midfield)
    const wingDist = 10 * scale; 
    const wingLen = 10 * scale; 
    // Top Wing
    ctx.beginPath();
    ctx.moveTo(x + w/2 - wingLen, y + wingDist);
    ctx.lineTo(x + w/2 + wingLen, y + wingDist);
    ctx.stroke();
    // Bottom Wing
    ctx.beginPath();
    ctx.moveTo(x + w/2 - wingLen, y + h - wingDist);
    ctx.lineTo(x + w/2 + wingLen, y + h - wingDist);
    ctx.stroke();

    // Alley Lines (10 yards from sidelines, extend from endline to restraining)
    const alleyDist = 10 * scale; 
    
    ctx.setLineDash([5, 5]); 
    // Top Left Alley
    ctx.beginPath(); ctx.moveTo(x, y + alleyDist); ctx.lineTo(x + restrainDist, y + alleyDist); ctx.stroke();
    // Bottom Left Alley
    ctx.beginPath(); ctx.moveTo(x, y + h - alleyDist); ctx.lineTo(x + restrainDist, y + h - alleyDist); ctx.stroke();
    // Top Right Alley
    ctx.beginPath(); ctx.moveTo(x + w, y + alleyDist); ctx.lineTo(x + w - restrainDist, y + alleyDist); ctx.stroke();
    // Bottom Right Alley
    ctx.beginPath(); ctx.moveTo(x + w, y + h - alleyDist); ctx.lineTo(x + w - restrainDist, y + h - alleyDist); ctx.stroke();
    ctx.setLineDash([]); 
  };

  const drawHalfField = (ctx, x, y, w, h, scale) => {
    // Half Field View: Vertical orientation
    // Y Axis: Bottom is 0 (Endline), Top is 65 (10 yards past midline)
    // X Axis: 0 to 60 (Width)
    
    // Helper to convert logical yards to canvas coords
    // Logical Y: 0 (bottom) -> 65 (top)
    // Canvas Y: y+h (bottom) -> y (top)
    const toCanvasX = (yardsX) => x + (yardsX * scale);
    const toCanvasY = (yardsY) => y + h - (yardsY * scale);

    // Outer Boundary (Bottom Endline, Top 65yd line, Sidelines)
    ctx.strokeRect(x, y, w, h);

    // Midline (at 55 yards)
    ctx.beginPath();
    ctx.moveTo(x, toCanvasY(55));
    ctx.lineTo(x + w, toCanvasY(55));
    ctx.stroke();

    // Restraining Line (at 35 yards)
    ctx.beginPath();
    ctx.moveTo(x, toCanvasY(35));
    ctx.lineTo(x + w, toCanvasY(35));
    ctx.stroke();

    // Goal (at 15 yards)
    const creaseRadius = Math.max(0, 3 * scale);
    const goalY = toCanvasY(15);
    const centerX = x + w / 2;

    // Crease
    ctx.beginPath();
    ctx.arc(centerX, goalY, creaseRadius, 0, Math.PI * 2);
    ctx.fillStyle = '#e5e7eb';
    ctx.fill();
    ctx.stroke();
    
    // Goal Marker (Width approx 2 yards = 6 ft)
    ctx.fillStyle = LINE_COLOR;
    ctx.fillRect(centerX - (3 * scale), goalY, 6 * scale, 2);

    // Center Circle (at 55 yards)
    // Full circle is drawn, even though we only see part of field above it? 
    // Yes, 10 yards past midline is enough for full 5 yard radius circle.
    ctx.beginPath();
    ctx.arc(centerX, toCanvasY(55), Math.max(0, 5 * scale), 0, Math.PI * 2);
    ctx.stroke();

    // Center X
    const xSize = 2 * scale;
    const midY = toCanvasY(55);
    ctx.beginPath();
    ctx.moveTo(centerX - xSize, midY - xSize);
    ctx.lineTo(centerX + xSize, midY + xSize);
    ctx.moveTo(centerX + xSize, midY - xSize);
    ctx.lineTo(centerX - xSize, midY + xSize);
    ctx.stroke();

    // Alley Lines (10 yards from sideline, 0 to 35 yards)
    const alleyDist = 10 * scale;
    ctx.setLineDash([5, 5]);
    
    // Left Alley
    ctx.beginPath();
    ctx.moveTo(x + alleyDist, toCanvasY(0));
    ctx.lineTo(x + alleyDist, toCanvasY(35));
    ctx.stroke();

    // Right Alley
    ctx.beginPath();
    ctx.moveTo(x + w - alleyDist, toCanvasY(0));
    ctx.lineTo(x + w - alleyDist, toCanvasY(35));
    ctx.stroke();

    // Wing Lines (10 yards from sideline, centered at midline)
    // Vertical lines in this view.
    // Length: 10 yards each side of midline (45 to 65 yards)
    // Position: 10 yards from sidelines.
    ctx.setLineDash([]);
    
    // Left Wing
    ctx.beginPath();
    ctx.moveTo(x + alleyDist, toCanvasY(45));
    ctx.lineTo(x + alleyDist, toCanvasY(65)); // Goes to top edge
    ctx.stroke();

    // Right Wing
    ctx.beginPath();
    ctx.moveTo(x + w - alleyDist, toCanvasY(45));
    ctx.lineTo(x + w - alleyDist, toCanvasY(65));
    ctx.stroke();
  };

  const drawField = (ctx, width, height) => {
    // Safety check
    const padding = 30;
    if (width <= padding * 2 || height <= padding * 2) {
      ctx.fillStyle = FIELD_COLOR;
      ctx.fillRect(0, 0, width, height);
      return;
    }

    // Background
    ctx.fillStyle = FIELD_COLOR;
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = LINE_COLOR;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';

    // Calculation Logic
    const drawWidth = width - (padding * 2);
    const drawHeight = height - (padding * 2);
    
    let w, h, x, y, fieldRatio;

    if (viewMode === 'full') {
        // Horizontal: 110 yards wide, 60 yards high
        fieldRatio = 110 / 60; 
    } else {
        // Vertical: 60 yards wide, 65 yards high (55 + 10)
        fieldRatio = 60 / 65;
    }

    const canvasRatio = drawWidth / drawHeight;

    if (canvasRatio > fieldRatio) {
      h = drawHeight;
      w = h * fieldRatio;
      y = padding;
      x = (width - w) / 2;
    } else {
      w = drawWidth;
      h = w / fieldRatio;
      x = padding;
      y = (height - h) / 2;
    }

    // Calculate Scale (Pixels per Yard)
    // Full: w / 110
    // Half: w / 60
    const scale = viewMode === 'full' ? w / 110 : w / 60;

    if (viewMode === 'full') {
        drawFullField(ctx, x, y, w, h, scale);
    } else {
        drawHalfField(ctx, x, y, w, h, scale);
    }
  };

  const drawElement = (ctx, element) => {
    ctx.strokeStyle = element.color;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (element.type === 'player') {
      ctx.beginPath();
      // Ensure radius is positive
      const safeRadius = Math.max(1, element.radius);
      ctx.arc(element.x, element.y, safeRadius, 0, Math.PI * 2);
      ctx.fillStyle = element.color; // Opaque
      ctx.fill();
      ctx.stroke();
      // Highlight selection
      if (selectedElementIds.includes(element.id)) {
        ctx.strokeStyle = '#22c55e';
        ctx.lineWidth = 2;
        ctx.stroke();
        
        // Add a small selection ring for better visibility
        ctx.beginPath();
        ctx.arc(element.x, element.y, safeRadius + 4, 0, Math.PI * 2);
        ctx.strokeStyle = '#22c55e';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

    } else if (element.type === 'circle') {
      ctx.beginPath();
      // Calculate radius based on drag distance
      const radius = Math.max(distance({x: element.sx, y: element.sy}, {x: element.ex, y: element.ey}), 10);
      ctx.arc(element.sx, element.sy, radius, 0, Math.PI * 2);
      ctx.fillStyle = element.color + '20'; // Very transparent
      ctx.fill();
      ctx.stroke();
      
      // Center dot
      ctx.beginPath();
      ctx.arc(element.sx, element.sy, 2, 0, Math.PI * 2);
      ctx.fillStyle = element.color;
      ctx.fill();

      if (selectedElementIds.includes(element.id)) {
        ctx.strokeStyle = '#22c55e';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

    } else if (element.type === 'line') {
      ctx.beginPath();
      ctx.moveTo(element.sx, element.sy);
      ctx.lineTo(element.ex, element.ey);
      ctx.stroke();
      
      // Arrowhead
      const headLen = 12;
      const dx = element.ex - element.sx;
      const dy = element.ey - element.sy;
      const angle = Math.atan2(dy, dx);
      ctx.beginPath();
      ctx.moveTo(element.ex, element.ey);
      ctx.lineTo(element.ex - headLen * Math.cos(angle - Math.PI / 6), element.ey - headLen * Math.sin(angle - Math.PI / 6));
      ctx.moveTo(element.ex, element.ey);
      ctx.lineTo(element.ex - headLen * Math.cos(angle + Math.PI / 6), element.ey - headLen * Math.sin(angle + Math.PI / 6));
      ctx.stroke();

      if (selectedElementIds.includes(element.id)) {
        ctx.strokeStyle = '#22c55e';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

    } else if (element.type === 'freehand') {
      if (element.points.length < 2) return;
      ctx.beginPath();
      ctx.moveTo(element.points[0].x, element.points[0].y);
      for (let i = 1; i < element.points.length; i++) {
        ctx.lineTo(element.points[i].x, element.points[i].y);
      }
      ctx.stroke();
      
      if (selectedElementIds.includes(element.id)) {
        ctx.strokeStyle = '#22c55e';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  };

  // Main Render Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    // Safety clear
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    drawField(ctx, canvas.width, canvas.height);

    // Draw saved elements
    elements.forEach(el => drawElement(ctx, el));

    // Draw current action
    if (currentElement) {
      drawElement(ctx, currentElement);
    }
    
    // Draw Selection Box
    if (selectionBox) {
        const x = Math.min(selectionBox.startX, selectionBox.currentX);
        const y = Math.min(selectionBox.startY, selectionBox.currentY);
        const w = Math.abs(selectionBox.currentX - selectionBox.startX);
        const h = Math.abs(selectionBox.currentY - selectionBox.startY);
        
        ctx.save();
        ctx.fillStyle = 'rgba(59, 130, 246, 0.1)';
        ctx.strokeStyle = '#2563eb';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);
        ctx.restore();
    }

  }, [elements, currentElement, selectedElementIds, selectionBox, viewMode]); // Added viewMode dependency

  // --- Resize Handler ---
  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current && canvasRef.current) {
        // Simple resize - note: this doesn't rescale element positions relative to new size
        // For a full app, you'd normalise coordinates (0-1) instead of pixels.
        // For now, we accept canvas size changes might clip elements.
        canvasRef.current.width = containerRef.current.clientWidth;
        canvasRef.current.height = containerRef.current.clientHeight;
        setElements(prev => [...prev]); // Trigger redraw
      }
    };

    window.addEventListener('resize', handleResize);
    handleResize();

    return () => window.removeEventListener('resize', handleResize);
  }, []);


  // --- Event Handlers ---

  const getPos = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    
    // Calculate scale factors to handle mismatch between CSS size and internal canvas size
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    };
  };

  const handleStart = (e) => {
    if (e.cancelable) e.preventDefault(); // Prevent scrolling on touch
    const { x, y } = getPos(e);
    setIsDrawing(true);

    if (tool === 'interact') {
      const hit = getElementAtPosition(x, y);
      
      if (hit) {
        // If clicking an item not currently selected, select only it (unless we add shift support later)
        // If clicking an item that IS selected, keep selection as is to allow group drag
        if (!selectedElementIds.includes(hit.id)) {
            setSelectedElementIds([hit.id]);
        }
        
        // Prepare for dragging
        setDragLastPos({ x, y });
        setSelectionBox(null);
      } else {
        // Clicked empty space -> Start Selection Box
        setSelectedElementIds([]); // Clear previous
        setSelectionBox({ startX: x, startY: y, currentX: x, currentY: y });
        setDragLastPos(null);
      }
      return;
    }

    if (tool === 'eraser') {
      const hit = getElementAtPosition(x, y);
      if (hit) {
        setElements(prev => prev.filter(el => el.id !== hit.id));
      }
      return;
    }

    // Drawing Tools
    const id = generateId();

    if (tool === 'player') {
      // Immediate placement
      // REDUCED SIZE: Radius changed from 12 to 8 (2/3 size)
      const newPlayer = { type: 'player', id, x, y, radius: 8, color };
      setElements(prev => [...prev, newPlayer]);
      setIsDrawing(false); 
      return;
    }

    if (tool === 'freehand') {
      setCurrentElement({ type: 'freehand', id, points: [{ x, y }], color });
    } else {
      // Line or Circle
      setCurrentElement({ type: tool, id, sx: x, sy: y, ex: x, ey: y, color });
    }
  };

  const handleMove = (e) => {
    if (!isDrawing && tool !== 'interact') return;
    // e.preventDefault(); // handled in start
    const { x, y } = getPos(e);

    // Eraser Drag Logic
    if (tool === 'eraser' && isDrawing) {
      const hit = getElementAtPosition(x, y);
      if (hit) {
        setElements(prev => prev.filter(el => el.id !== hit.id));
      }
      return;
    }

    if (tool === 'interact' && isDrawing) {
      // 1. Box Selection Logic
      if (selectionBox) {
        setSelectionBox(prev => ({ ...prev, currentX: x, currentY: y }));
        return;
      }

      // 2. Group Drag Logic
      if (selectedElementIds.length > 0 && dragLastPos) {
         const dx = x - dragLastPos.x;
         const dy = y - dragLastPos.y;

         setElements(prev => prev.map(el => {
             if (!selectedElementIds.includes(el.id)) return el;

             if (el.type === 'player') {
                 return { ...el, x: el.x + dx, y: el.y + dy };
             }
             if (el.type === 'line' || el.type === 'circle') {
                 return { ...el, sx: el.sx + dx, sy: el.sy + dy, ex: el.ex + dx, ey: el.ey + dy };
             }
             if (el.type === 'freehand') {
                 return { ...el, points: el.points.map(p => ({ x: p.x + dx, y: p.y + dy })) };
             }
             return el;
         }));

         setDragLastPos({ x, y });
      }
      return;
    }

    if (!currentElement) return;

    if (tool === 'freehand') {
      setCurrentElement(prev => ({
        ...prev,
        points: [...prev.points, { x, y }]
      }));
    } else {
      setCurrentElement(prev => ({
        ...prev,
        ex: x,
        ey: y
      }));
    }
  };

  const handleEnd = () => {
    setIsDrawing(false);
    
    if (tool === 'interact') {
        if (selectionBox) {
            // Finalize selection
            // Normalize rect
            const x1 = Math.min(selectionBox.startX, selectionBox.currentX);
            const y1 = Math.min(selectionBox.startY, selectionBox.currentY);
            const w = Math.abs(selectionBox.currentX - selectionBox.startX);
            const h = Math.abs(selectionBox.currentY - selectionBox.startY);
            const rect = { x: x1, y: y1, w, h };

            // Find elements intersecting box
            const newlySelected = elements.filter(el => isElementInRect(el, rect)).map(el => el.id);
            setSelectedElementIds(newlySelected);
            setSelectionBox(null);
        }
        setDragLastPos(null);
    }
    
    if (currentElement) {
      setElements(prev => [...prev, currentElement]);
      setCurrentElement(null);
    }
  };

  const handleClearTrigger = () => {
    setShowClearConfirm(true);
  };

  const handleConfirmClear = () => {
    setElements([]);
    setCurrentElement(null);
    setSelectedElementIds([]);
    setShowClearConfirm(false);
  };

  const handleCancelClear = () => {
    setShowClearConfirm(false);
  };

  const handleUndo = () => {
    setElements(prev => prev.slice(0, -1));
  };

  const handleDownload = () => {
    const canvas = canvasRef.current;
    // Create a temporary canvas to draw white background so transparent png isn't black in some viewers
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const tCtx = tempCanvas.getContext('2d');
    tCtx.fillStyle = '#ffffff';
    tCtx.fillRect(0,0, tempCanvas.width, tempCanvas.height);
    tCtx.drawImage(canvas, 0, 0);
    
    const link = document.createElement('a');
    link.download = 'lacrosse-play.png';
    link.href = tempCanvas.toDataURL();
    link.click();
  };

  // --- UI Components ---
  
  // Refactored to accept icon element directly to avoid React child errors
  const ToolButton = ({ active, onClick, icon, label }) => (
    <button
      onClick={onClick}
      className={`p-3 rounded-lg flex flex-col items-center justify-center transition-all ${
        active 
          ? 'bg-slate-800 text-white shadow-lg scale-105' 
          : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
      }`}
      title={label}
    >
      {icon}
      <span className="text-xs mt-1 font-medium">{label}</span>
    </button>
  );

  const ColorButton = ({ active, colorStr, onClick, label }) => (
    <button
      onClick={onClick}
      title={label}
      className={`w-8 h-8 rounded-full border-2 transition-transform ${
        active ? 'border-slate-800 scale-110 shadow-md ring-2 ring-offset-1 ring-slate-300' : 'border-transparent hover:scale-105'
      }`}
      style={{ backgroundColor: colorStr }}
    />
  );

  return (
    <div className="flex flex-col h-screen bg-slate-50 font-sans">
      
      {/* Header */}
      <header className="bg-white border-b border-slate-200 p-4 shadow-sm flex justify-between items-center z-10">
        <h1 className="text-xl font-bold flex items-center gap-2 text-slate-800">
          <div className="w-8 h-8 bg-slate-800 rounded flex items-center justify-center">
            <span className="text-white font-bold">LX</span>
          </div>
          LaxCoach Whiteboard
        </h1>
        <div className="text-sm text-slate-500 hidden sm:block">
          Select <span className="font-bold">Interact</span> to move items
        </div>
      </header>

      {/* Main Workspace */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden relative">
        
        {/* Toolbar */}
        <div className="bg-white border-b md:border-b-0 md:border-r border-slate-200 p-4 md:w-24 flex md:flex-col gap-3 items-center md:justify-start justify-between overflow-x-auto shrink-0 z-20 shadow-[4px_0_24px_rgba(0,0,0,0.02)]">
          
          <div className="flex md:flex-col gap-2">
            <ToolButton active={viewMode === 'full'} onClick={() => setViewMode('full')} icon={<RectangleHorizontal size={24} />} label="Full" />
            <ToolButton active={viewMode === 'half'} onClick={() => setViewMode('half')} icon={<RectangleVertical size={24} />} label="Half" />
          </div>

          <div className="w-px h-8 md:w-8 md:h-px bg-slate-200 my-2" />

          <div className="flex md:flex-col gap-2">
            <ToolButton active={tool === 'interact'} onClick={() => setTool('interact')} icon={<Hand size={24} />} label="Move" />
            <ToolButton active={tool === 'player'} onClick={() => setTool('player')} icon={<User size={24} />} label="Player" />
            <ToolButton active={tool === 'line'} onClick={() => setTool('line')} icon={<Minus size={24} />} label="Line" />
            <ToolButton active={tool === 'circle'} onClick={() => setTool('circle')} icon={<Circle size={24} />} label="Zone" />
            <ToolButton active={tool === 'freehand'} onClick={() => setTool('freehand')} icon={<Pen size={24} />} label="Draw" />
            <ToolButton active={tool === 'eraser'} onClick={() => setTool('eraser')} icon={<Eraser size={24} />} label="Erase" />
          </div>

          <div className="w-px h-8 md:w-8 md:h-px bg-slate-200 my-2" />

          <div className="flex md:flex-col gap-2 items-center">
            <ColorButton colorStr="#ef4444" active={color === '#ef4444'} onClick={() => setColor('#ef4444')} label="Red" />
            <ColorButton colorStr="#3b82f6" active={color === '#3b82f6'} onClick={() => setColor('#3b82f6')} label="Blue" />
            <ColorButton colorStr="#000000" active={color === '#000000'} onClick={() => setColor('#000000')} label="Black" />
            <ColorButton colorStr="#eab308" active={color === '#eab308'} onClick={() => setColor('#eab308')} label="Yellow" />
          </div>

          <div className="flex-1" />

          <div className="flex md:flex-col gap-2">
            <button onClick={handleUndo} className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded" title="Undo">
              <RotateCcw size={20} />
            </button>
            <button onClick={handleClearTrigger} className="p-2 text-red-500 hover:text-red-700 hover:bg-red-50 rounded" title="Clear All">
              <Trash2 size={20} />
            </button>
            <button onClick={handleDownload} className="p-2 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded" title="Download">
              <Download size={20} />
            </button>
          </div>

        </div>

        {/* Canvas Area */}
        <div className="flex-1 bg-slate-100 relative overflow-hidden flex items-center justify-center p-4" ref={containerRef}>
          <div className="relative shadow-xl rounded-sm overflow-hidden bg-white border border-slate-200">
            <canvas
              ref={canvasRef}
              className={`block touch-none ${tool === 'interact' ? 'cursor-move' : tool === 'eraser' ? 'cursor-crosshair' : 'cursor-crosshair'}`}
              onMouseDown={handleStart}
              onMouseMove={handleMove}
              onMouseUp={handleEnd}
              onMouseLeave={handleEnd}
              onTouchStart={handleStart}
              onTouchMove={handleMove}
              onTouchEnd={handleEnd}
              style={{ maxHeight: '100%', maxWidth: '100%' }}
            />
          </div>
          
          {/* Custom Clear Confirmation Modal */}
          {showClearConfirm && (
            <div className="absolute inset-0 bg-black/20 flex items-center justify-center z-50 backdrop-blur-sm">
              <div className="bg-white p-6 rounded-xl shadow-2xl transform scale-100 transition-all max-w-sm w-full mx-4">
                <h3 className="text-lg font-bold text-slate-800 mb-2">Clear entire board?</h3>
                <p className="text-slate-500 mb-6 text-sm">This action cannot be undone. All players and drawings will be removed.</p>
                <div className="flex gap-3">
                  <button 
                    onClick={handleCancelClear}
                    className="flex-1 py-2 px-4 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 font-medium flex items-center justify-center gap-2"
                  >
                    <X size={16} /> Cancel
                  </button>
                  <button 
                    onClick={handleConfirmClear}
                    className="flex-1 py-2 px-4 rounded-lg bg-red-600 text-white hover:bg-red-700 font-medium shadow-sm flex items-center justify-center gap-2"
                  >
                    <Check size={16} /> Clear Board
                  </button>
                </div>
              </div>
            </div>
          )}

        </div>

      </div>
    </div>
  );
};

export default LacrosseBoard;