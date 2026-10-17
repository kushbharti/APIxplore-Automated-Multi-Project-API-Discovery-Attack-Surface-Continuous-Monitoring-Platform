import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

export interface ParticleHeroProps {
  scrollProgress?: number; // 0.0 to 1.0
  activeStage?: number; // 0 to 6
  onStageChange?: (stage: number) => void;
  className?: string;
}

export const ParticleHero3D: React.FC<ParticleHeroProps> = ({
  scrollProgress = 0,
  activeStage = 0,
  onStageChange,
  className = ''
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const [isWebGLAvailable, setIsWebGLAvailable] = useState<boolean>(true);
  const [particleCount, setParticleCount] = useState<number>(1200);
  const [connectionDistance, setConnectionDistance] = useState<number>(75);
  const [particleSpeed, setParticleSpeed] = useState<number>(1.0);
  const [interactiveForce, setInteractiveForce] = useState<number>(1.2);
  const [showControls, setShowControls] = useState<boolean>(false);

  useEffect(() => {
    if (onStageChange) {
      onStageChange(activeStage);
    }
  }, [activeStage, onStageChange]);

  // References to keep state in animation frame without re-instantiating WebGL
  const stateRef = useRef({
    scrollProgress: 0,
    activeStage: 0,
    particleSpeed: 1.0,
    interactiveForce: 1.2,
    connectionDistance: 75,
    mouse: new THREE.Vector2(-9999, -9999),
    targetMouse: new THREE.Vector2(-9999, -9999),
  });

  useEffect(() => {
    stateRef.current.scrollProgress = scrollProgress;
    stateRef.current.activeStage = activeStage;
  }, [scrollProgress, activeStage]);

  useEffect(() => {
    stateRef.current.particleSpeed = particleSpeed;
    stateRef.current.interactiveForce = interactiveForce;
    stateRef.current.connectionDistance = connectionDistance;
  }, [particleSpeed, interactiveForce, connectionDistance]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    // Detect mobile or low performance
    const isMobile = window.innerWidth < 768;
    const initialCount = isMobile ? 500 : 1200;
    setParticleCount(initialCount);

    // Check for prefers-reduced-motion
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Setup Three.js scene
    let renderer: THREE.WebGLRenderer | null = null;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance'
      });
    } catch {
      setIsWebGLAvailable(false);
      return;
    }

    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x06090e, 0.0012);

    const camera = new THREE.PerspectiveCamera(
      55,
      container.clientWidth / container.clientHeight,
      1,
      2000
    );
    camera.position.set(0, 0, 480);

    // Particle data buffers
    const count = initialCount;
    const positions = new Float32Array(count * 3);
    const originPositions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);

    // Base color palettes: Cobalt Blue (#2563EB / #3B82F6), Soft Whitish (#E2E8F0), Accent Emerald (#10B981)
    const cobaltColor = new THREE.Color(0x2563eb);
    const cobaltBright = new THREE.Color(0x60a5fa);
    const whitishColor = new THREE.Color(0xe2e8f0);
    const emeraldColor = new THREE.Color(0x10b981);
    const amberColor = new THREE.Color(0xf59e0b);

    // Initialize particles into an organic 3D cloud
    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      // Spherical distribution with radius variation
      const radius = 180 + Math.random() * 320;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);

      const x = radius * Math.sin(phi) * Math.cos(theta);
      const y = (radius * Math.sin(phi) * Math.sin(theta)) * 0.7; // slight oval
      const z = (radius * Math.cos(phi)) * 0.9;

      positions[i3] = x;
      positions[i3 + 1] = y;
      positions[i3 + 2] = z;

      originPositions[i3] = x;
      originPositions[i3 + 1] = y;
      originPositions[i3 + 2] = z;

      velocities[i3] = (Math.random() - 0.5) * 0.4;
      velocities[i3 + 1] = (Math.random() - 0.5) * 0.4;
      velocities[i3 + 2] = (Math.random() - 0.5) * 0.4;

      // Color distribution: 65% Cobalt blue shades, 25% luminous whitish, 10% emerald
      const rand = Math.random();
      const pColor = rand > 0.35 ? cobaltColor : rand > 0.1 ? whitishColor : cobaltBright;
      colors[i3] = pColor.r;
      colors[i3 + 1] = pColor.g;
      colors[i3 + 2] = pColor.b;

      sizes[i] = Math.random() * 3.5 + 1.5;
    }

    const particleGeometry = new THREE.BufferGeometry();
    particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    particleGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    particleGeometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    // Create high-detail circular glow particle texture via canvas
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
    grad.addColorStop(0.2, 'rgba(96, 165, 250, 0.85)');
    grad.addColorStop(0.6, 'rgba(37, 99, 235, 0.35)');
    grad.addColorStop(1, 'rgba(5, 7, 10, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    const particleTexture = new THREE.CanvasTexture(canvas);

    const particleMaterial = new THREE.PointsMaterial({
      size: 4.5,
      map: particleTexture,
      transparent: true,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true
    });

    const particlePoints = new THREE.Points(particleGeometry, particleMaterial);
    scene.add(particlePoints);

    // Proximity Lines Buffer Geometry
    const maxLines = count * 3;
    const linePositions = new Float32Array(maxLines * 6);
    const lineColors = new Float32Array(maxLines * 6);

    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3).setUsage(THREE.DynamicDrawUsage));
    lineGeometry.setAttribute('color', new THREE.BufferAttribute(lineColors, 3).setUsage(THREE.DynamicDrawUsage));

    const lineMaterial = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    const linesMesh = new THREE.LineSegments(lineGeometry, lineMaterial);
    scene.add(linesMesh);

    // Mouse listener
    const onPointerMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
      stateRef.current.targetMouse.set(x * 350, y * 250);
    };

    const onPointerLeave = () => {
      stateRef.current.targetMouse.set(-9999, -9999);
    };

    window.addEventListener('mousemove', onPointerMove, { passive: true });
    container.addEventListener('mouseleave', onPointerLeave, { passive: true });

    // Resize handler
    const onResize = () => {
      if (!container || !renderer) return;
      const width = container.clientWidth;
      const height = container.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    window.addEventListener('resize', onResize);

    // Precalculate stage targets for API route group tree morphing
    // Tree topology: Root node -> 4 Route clusters -> Sub-endpoints
    const treePositions = new Float32Array(count * 3);
    const clusterCenters = [
      new THREE.Vector3(-140, 70, 0),   // /api
      new THREE.Vector3(140, 70, 0),    // /products
      new THREE.Vector3(-140, -70, 0),  // /docs
      new THREE.Vector3(140, -70, 0),   // /public
    ];

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      if (i < 20) {
        // Root cluster
        treePositions[i3] = (Math.random() - 0.5) * 40;
        treePositions[i3 + 1] = (Math.random() - 0.5) * 40;
        treePositions[i3 + 2] = (Math.random() - 0.5) * 30;
      } else {
        const clusterIdx = i % 4;
        const center = clusterCenters[clusterIdx];
        const angle = Math.random() * Math.PI * 2;
        const dist = 25 + Math.random() * 85;
        treePositions[i3] = center.x + Math.cos(angle) * dist;
        treePositions[i3 + 1] = center.y + Math.sin(angle) * dist * 0.7;
        treePositions[i3 + 2] = (Math.random() - 0.5) * 80;
      }
    }

    // Animation Loop
    let animationFrameId: number;
    let clock = new THREE.Clock();

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      const elapsed = clock.getElapsedTime();

      // Smooth mouse interpolation
      stateRef.current.mouse.lerp(stateRef.current.targetMouse, 0.08);

      const pos = particleGeometry.attributes.position.array as Float32Array;
      const col = particleGeometry.attributes.color.array as Float32Array;
      const curScroll = stateRef.current.scrollProgress;
      const speed = prefersReducedMotion ? 0.1 : stateRef.current.particleSpeed;
      const force = stateRef.current.interactiveForce;
      const maxDist = stateRef.current.connectionDistance;

      // Morph factor between organic cloud (0) and hierarchical route graph (1) based on scroll
      const morphFactor = Math.min(Math.max((curScroll - 0.15) / 0.5, 0), 1);

      // Camera motion linked to scroll
      camera.position.z = 480 - curScroll * 180;
      camera.position.y = -curScroll * 60;
      camera.rotation.z = curScroll * 0.12;

      let lineVertexIndex = 0;
      let lineCount = 0;

      // Update particles
      for (let i = 0; i < count; i++) {
        const i3 = i * 3;

        // Base drift
        if (!prefersReducedMotion) {
          originPositions[i3] += velocities[i3] * speed;
          originPositions[i3 + 1] += velocities[i3 + 1] * speed;
          originPositions[i3 + 2] += velocities[i3 + 2] * speed;

          // Boundary bounce in cloud
          if (Math.abs(originPositions[i3]) > 380) velocities[i3] *= -1;
          if (Math.abs(originPositions[i3 + 1]) > 260) velocities[i3 + 1] *= -1;
          if (Math.abs(originPositions[i3 + 2]) > 250) velocities[i3 + 2] *= -1;
        }

        // Interpolate between cloud origin and hierarchical tree topology
        let targetX = originPositions[i3] * (1 - morphFactor) + treePositions[i3] * morphFactor;
        let targetY = originPositions[i3 + 1] * (1 - morphFactor) + treePositions[i3 + 1] * morphFactor;
        let targetZ = originPositions[i3 + 2] * (1 - morphFactor) + treePositions[i3 + 2] * morphFactor;

        // Interactive pointer repulsion / suction
        const dx = targetX - stateRef.current.mouse.x;
        const dy = targetY - stateRef.current.mouse.y;
        const mouseDist = Math.sqrt(dx * dx + dy * dy);

        if (mouseDist < 140) {
          const repelFactor = (1 - mouseDist / 140) * 35 * force;
          targetX += (dx / mouseDist) * repelFactor;
          targetY += (dy / mouseDist) * repelFactor;
        }

        // Apply smooth ease to positions
        pos[i3] += (targetX - pos[i3]) * 0.1;
        pos[i3 + 1] += (targetY - pos[i3 + 1]) * 0.1;
        pos[i3 + 2] += (targetZ - pos[i3 + 2]) * 0.1;

        // Color transitions across stages (Verify & Monitor stages)
        if (curScroll > 0.45) {
          // In Verify/Monitor stage: alternating verified emerald & unverified amber
          if (i % 7 === 0) {
            col[i3] = amberColor.r;
            col[i3 + 1] = amberColor.g;
            col[i3 + 2] = amberColor.b;
          } else if (i % 3 === 0) {
            col[i3] = emeraldColor.r;
            col[i3 + 1] = emeraldColor.g;
            col[i3 + 2] = emeraldColor.b;
          } else {
            col[i3] = cobaltBright.r;
            col[i3 + 1] = cobaltBright.g;
            col[i3 + 2] = cobaltBright.b;
          }
        } else {
          // In Hero / Connect stage: Signature cobalt blue & whitish luminescence
          const rand = (i % 10) / 10;
          const chosen = rand > 0.4 ? cobaltColor : rand > 0.15 ? whitishColor : cobaltBright;
          col[i3] += (chosen.r - col[i3]) * 0.05;
          col[i3 + 1] += (chosen.g - col[i3 + 1]) * 0.05;
          col[i3 + 2] += (chosen.b - col[i3 + 2]) * 0.05;
        }

        // Connect nearby particles with lines (sample a subset for high 60fps performance)
        if (lineCount < maxLines && i % 2 === 0) {
          for (let j = i + 1; j < Math.min(i + 14, count); j++) {
            const j3 = j * 3;
            const distSq =
              (pos[i3] - pos[j3]) ** 2 +
              (pos[i3 + 1] - pos[j3 + 1]) ** 2 +
              (pos[i3 + 2] - pos[j3 + 2]) ** 2;

            if (distSq < maxDist * maxDist) {
              const alpha = Math.max(0, 1 - Math.sqrt(distSq) / maxDist);

              linePositions[lineVertexIndex] = pos[i3];
              linePositions[lineVertexIndex + 1] = pos[i3 + 1];
              linePositions[lineVertexIndex + 2] = pos[i3 + 2];

              lineColors[lineVertexIndex] = col[i3] * alpha;
              lineColors[lineVertexIndex + 1] = col[i3 + 1] * alpha;
              lineColors[lineVertexIndex + 2] = col[i3 + 2] * alpha;

              linePositions[lineVertexIndex + 3] = pos[j3];
              linePositions[lineVertexIndex + 4] = pos[j3 + 1];
              linePositions[lineVertexIndex + 5] = pos[j3 + 2];

              lineColors[lineVertexIndex + 3] = col[j3] * alpha;
              lineColors[lineVertexIndex + 4] = col[j3 + 1] * alpha;
              lineColors[lineVertexIndex + 5] = col[j3 + 2] * alpha;

              lineVertexIndex += 6;
              lineCount++;
            }
          }
        }
      }

      particleGeometry.attributes.position.needsUpdate = true;
      particleGeometry.attributes.color.needsUpdate = true;

      // Update line mesh
      lineGeometry.setDrawRange(0, lineCount * 2);
      lineGeometry.attributes.position.needsUpdate = true;
      lineGeometry.attributes.color.needsUpdate = true;

      // Gentle orbital rotation
      if (!prefersReducedMotion) {
        particlePoints.rotation.y = elapsed * 0.03 * speed;
        linesMesh.rotation.y = particlePoints.rotation.y;
      }

      renderer!.render(scene, camera);
    };

    animate();

    // Cleanup resources
    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('mousemove', onPointerMove);
      window.removeEventListener('resize', onResize);
      container.removeEventListener('mouseleave', onPointerLeave);

      particleGeometry.dispose();
      particleMaterial.dispose();
      lineGeometry.dispose();
      lineMaterial.dispose();
      particleTexture.dispose();

      if (renderer) {
        renderer.dispose();
        if (renderer.domElement && container.contains(renderer.domElement)) {
          container.removeChild(renderer.domElement);
        }
      }
    };
  }, []);

  return (
    <div className={`relative w-full h-full overflow-hidden ${className}`}>
      {/* Three.js Mount Container */}
      <div ref={mountRef} className="absolute inset-0 w-full h-full z-0 cursor-crosshair" />

      {/* 2D Fallback if WebGL unavailable */}
      {!isWebGLAvailable && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#070b12] text-[#94a3b8] text-sm">
          <p>WebGL Hardware Acceleration Disabled — Falling back to 2D Attack Surface View</p>
        </div>
      )}

      {/* Simulator Tuning Toolbar (Casberry Reference Inspired) */}
      <div className="absolute bottom-6 right-6 z-20 flex flex-col items-end gap-2">
        <button
          onClick={() => setShowControls(!showControls)}
          className="px-3.5 py-1.5 rounded-lg text-xs font-semibold backdrop-blur-md transition-all duration-200 border"
          style={{
            background: showControls ? 'rgba(37, 99, 235, 0.25)' : 'rgba(10, 14, 23, 0.75)',
            borderColor: showControls ? '#2563eb' : 'rgba(255, 255, 255, 0.1)',
            color: '#f8fafc',
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          }}
        >
          {showControls ? 'Hide Simulator Controls' : '3D Particle Physics Controls'}
        </button>

        {showControls && (
          <div
            className="w-72 p-4 rounded-xl backdrop-blur-xl border flex flex-col gap-3 text-xs text-[#e2e8f0]"
            style={{
              background: 'rgba(10, 14, 23, 0.88)',
              borderColor: 'rgba(37, 99, 235, 0.3)',
              boxShadow: '0 12px 36px rgba(0, 0, 0, 0.6)',
            }}
          >
            <div className="flex items-center justify-between border-b pb-2 border-white/10">
              <span className="font-semibold text-white">Casberry Swarm Parameters</span>
              <span className="text-[10px] text-[#60a5fa] font-mono">{particleCount} Nodes</span>
            </div>

            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-[11px] text-[#94a3b8]">
                <span>Speed Velocity</span>
                <span>{particleSpeed.toFixed(1)}x</span>
              </div>
              <input
                type="range"
                min="0.2"
                max="2.5"
                step="0.1"
                value={particleSpeed}
                onChange={(e) => setParticleSpeed(parseFloat(e.target.value))}
                className="w-full accent-blue-500 cursor-pointer h-1.5 bg-slate-700 rounded-lg"
              />
            </div>

            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-[11px] text-[#94a3b8]">
                <span>Connection Radius</span>
                <span>{connectionDistance}px</span>
              </div>
              <input
                type="range"
                min="30"
                max="120"
                step="5"
                value={connectionDistance}
                onChange={(e) => setConnectionDistance(parseInt(e.target.value))}
                className="w-full accent-blue-500 cursor-pointer h-1.5 bg-slate-700 rounded-lg"
              />
            </div>

            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-[11px] text-[#94a3b8]">
                <span>Repulsion Vortex</span>
                <span>{interactiveForce.toFixed(1)}x</span>
              </div>
              <input
                type="range"
                min="0.2"
                max="2.5"
                step="0.1"
                value={interactiveForce}
                onChange={(e) => setInteractiveForce(parseFloat(e.target.value))}
                className="w-full accent-blue-500 cursor-pointer h-1.5 bg-slate-700 rounded-lg"
              />
            </div>

            <div className="pt-1 text-[10px] text-[#64748b] leading-tight">
              Hover pointer to deflect swarm. Scroll downwards to trigger route topology morphing.
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
