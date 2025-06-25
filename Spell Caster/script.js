/*
  Comments here are a work in progress,
  check back soon for more :)

  I also plan on sharing this same code
  in Github where things are broken up
  into more files. Check back for the link.

  Right lets do this, we have a lot to
  cover! Lets get started with...

  _____                            _
 |_   _|                          | |
   | |  _ __ ___  _ __   ___  _ __| |_ ___
   | | | '_ ` _ \| '_ \ / _ \| '__| __/ __|
  _| |_| | | | | | |_) | (_) | |  | |_\\__ \
 |_____|_| |_| |_| .__/ \___/|_|   \__|___/
                 | |
                 |_|

  GSAP first. We'll use this to do a lot
  of animations. What's nice about GSAP is
  it's happy animating almost anything...
  We'll be animating SVGs, HTML, shaders
  and 3D objects!
*/

import { gsap } from "https://cdn.skypack.dev/gsap";
import { MotionPathPlugin } from "https://cdn.skypack.dev/gsap/MotionPathPlugin";
import { Flip } from "https://cdn.skypack.dev/gsap/Flip";
gsap.registerPlugin(MotionPathPlugin, Flip);

/*
  We need some simplex noise to help
  with the particle animations and a few other things.
  I am using this noise based on a demo by Richard Mattes:
  https://code.google.com/archive/p/simplexnoise/
*/
import { SimplexNoise } from "https://cdn.skypack.dev/simplex-noise";

/*
  We'll be doing a lot of 3D with Three.js.
  This is probably the most complex part of the code,
  but I'll try to explain it as best I can.
  I am importing the core Three.js library and some
  add-ons for loading 3D models (GLTFLoader),
  creating a custom shader pass (ShaderPass),
  and applying effects (EffectComposer, RenderPass).
*/
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";

/*
  For managing the game state, I'm using XState.
  This helps keep the game logic organized and
  makes it easier to handle transitions between
  different game screens and states (e.g., loading,
  title screen, playing, paused, game over).
*/
import { createMachine, interpret } from "https://cdn.skypack.dev/xstate";

/*
  Stats.js is a performance monitor that I use
  during development to check FPS and other metrics.
  It's useful for debugging performance issues.
*/
import Stats from "https://cdn.skypack.dev/stats.js";

/*
  Lastly, I'm using Howler.js for audio.
  It's a great library for web audio because it
  handles different audio formats and provides
  a consistent API for sound effects and music.
*/
import { Howl, Howler } from "https://cdn.skypack.dev/howler";

// --- GLOBAL APP STATE ---
// This object will hold all the main game variables and instances.
// It's a central place to manage everything.
const APP = {
  // Debug flags to show/hide various panels or overlays
  DEBUG_PANELS: false,
  DEBUG_OVERLAYS: false,
  // Game settings
  FPS: 60, // Target frames per second
  DEMONS_TO_KILL: 50, // Number of demons to kill in campaign mode
  ENDLESS_MODE_START_HEALTH: 0.5, // Starting health in endless mode
  ENDLESS_MODE_START_DEMONS: 10, // Starting demons in endless mode
  HEALTH_REPLENISH_RATE: 0.005, // How fast health regenerates
  HEALTH_DECAY_RATE: 0.0001, // How fast health decays when demons are present
  MAX_ACTIVE_DEMONS: 20, // Maximum demons on screen at once
  DEMON_SPAWN_RATE: 0.8, // How often demons spawn (lower is faster)
  BASE_DEMON_SPEED: 0.1, // Base speed of demons
  // Game state variables
  health: 1, // Current crystal health (0-1)
  demonsKilled: 0, // Count of demons killed
  isPlaying: false, // Is the game running?
  rotating: true, // Is the scene rotating?
  rotationSpeed: 0.05, // Speed of scene rotation
  targetRotationSpeed: 0.05, // Target rotation speed for smooth transitions
  lastFrameTime: 0, // Timestamp of the last animation frame
  elapsedGameTime: 0, // Total elapsed game time
  frame: 0, // Current animation frame
  // Three.js related objects
  renderer: null,
  scene: null,
  camera: null,
  composer: null, // For post-processing effects
  gltfLoader: null, // GLTF model loader
  mixer: null, // Animation mixer for 3D models
  actions: {}, // Animation actions
  // Game objects
  stage: null, // The main 3D stage/environment
  crystal: null, // The crystal object
  enemies: [], // Array of active demon enemies
  enemyLocations: [], // Spawn points for enemies
  hand: null, // The player's hand model
  spellLights: [], // Lights emitted by spells
  spellLightsCount: 0,
  // UI elements
  ui: {}, // References to various UI elements
  // Audio
  audio: {}, // Howler audio instances
  // XState machine interpreter
  machine: null,
  // Performance stats
  stats: null,
  // Simplex noise for procedural effects
  noise: new SimplexNoise(),
};

// --- WEBGL SHADERS ---
// These are GLSL (OpenGL Shading Language) programs that run on the GPU.
// They define how objects are rendered.

// Vertex Shader: Determines the position of each vertex.
const VERTEX_SHADER = `
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Fragment Shader: Determines the color of each pixel.
// This one creates a simple colored sphere.
const FRAGMENT_SHADER = `
  uniform vec3 color; // Color of the sphere
  void main() {
    gl_FragColor = vec4(color, 1.0);
  }
`;

/*
  This custom shader helps render a pulsating light effect for spells.
  It calculates a glow based on distance from the center and time.
*/
const GlowShader = {
  uniforms: {
    tDiffuse: { value: null }, // The input texture (from previous render pass)
    time: { value: 0.0 }, // Time uniform for animation
    color: { value: new THREE.Color(0xd54adf) }, // Color of the glow
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform float time;
    uniform vec3 color;
    uniform sampler2D tDiffuse;
    varying vec2 vUv;

    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      // Simple glow effect
      float intensity = 0.5 + 0.5 * sin(time * 5.0); // Pulsating effect
      gl_FragColor = texel + vec4(color * intensity, 0.0);
    }
  `,
};

// --- GAME CLASSES ---
// Organizing game logic into classes makes it modular and reusable.

// Base class for any game object that has a 3D model.
class GameObject {
  constructor(model, x = 0, y = 0, z = 0, scale = 1) {
    this.model = model;
    this.model.position.set(x, y, z);
    this.model.scale.set(scale, scale, scale);
    APP.scene.add(this.model); // Add to the Three.js scene
  }

  // Update method (can be overridden by subclasses)
  tick(delta) {
    // Override in subclasses
  }

  dispose() {
    APP.scene.remove(this.model);
    this.model.traverse((object) => {
      if (object.isMesh) {
        object.geometry.dispose();
        if (object.material.isMaterial) {
          cleanMaterial(object.material);
        } else {
          // An array of materials
          for (const material of object.material) cleanMaterial(material);
        }
      }
    });
  }
}

// Function to safely dispose of Three.js materials
function cleanMaterial(material) {
  material.dispose();
  // Dispose textures
  for (const key of Object.keys(material)) {
    const value = material[key];
    if (value && typeof value === "object" && "dispose" in value) {
      value.dispose();
    }
  }
}

// Represents the main game stage/environment.
class Stage {
  constructor(model) {
    this.model = model;
    this.model.position.set(0, -1, 0); // Position the stage
    this.model.scale.set(0.1, 0.1, 0.1); // Scale the stage
    this.everything = new THREE.Group(); // Group to hold all rotatable objects
    this.everything.add(this.model);
    APP.scene.add(this.everything);
  }

  tick() {
    // The stage might have its own animations or updates
  }
}

// Represents the Crystal that the player must protect.
class Crystal extends GameObject {
  constructor(model) {
    super(model); // Call parent constructor
    this.model.position.y = 0.5; // Adjust crystal position
    // Add a point light to the crystal for a glowing effect
    this.pointLight = new THREE.PointLight(APP.CRYSTAL_COLOR, 1, 10);
    this.pointLight.position.set(0, 1, 0);
    this.model.add(this.pointLight); // Attach light to crystal
  }

  tick(delta) {
    // Crystal might pulsate or change color based on health
    this.pointLight.intensity = APP.health * 2 + 0.5 * Math.sin(APP.elapsedGameTime * 5); // Pulsate based on health
    this.pointLight.color.set(APP.health > 0.5 ? APP.CRYSTAL_COLOR : 0xFF0000); // Red if low health
  }
}

// Represents an enemy (Demon).
class Enemy extends GameObject {
  constructor(model, startPosition, targetPosition, speed) {
    super(model, startPosition.x, startPosition.y, startPosition.z, 0.05); // Smaller scale for demons
    this.startPosition = new THREE.Vector3(
      startPosition.x,
      startPosition.y,
      startPosition.z
    );
    this.targetPosition = new THREE.Vector3(
      targetPosition.x,
      targetPosition.y,
      targetPosition.z
    );
    this.speed = speed;
    this.pathLength = this.startPosition.distanceTo(this.targetPosition);
    this.progress = 0; // Progress along the path (0 to 1)
    this.isActive = true; // Flag if demon is active
    this.model.lookAt(this.targetPosition); // Make demon face the crystal
  }

  tick(delta) {
    if (!this.isActive) return;

    this.progress += (this.speed * delta) / this.pathLength;
    this.progress = Math.min(this.progress, 1); // Clamp progress to 1

    this.model.position.lerpVectors(
      this.startPosition,
      this.targetPosition,
      this.progress
    );

    if (this.progress >= 1) {
      // Demon reached the crystal
      this.isActive = false;
      APP.health -= 0.1; // Reduce crystal health
      this.dispose(); // Remove demon from scene
    }
  }

  // Method to "kill" the demon
  hit() {
    this.isActive = false;
    APP.demonsKilled++; // Increment killed count
    this.dispose(); // Remove demon from scene
  }
}

// Manages enemy spawning.
class EnemySpawner {
  constructor() {
    this.spawnInterval = APP.DEMON_SPAWN_RATE; // Time between spawns
    this.lastSpawnTime = 0;
    // Define potential spawn locations and target (crystal)
    this.spawnPoints = [
      new THREE.Vector3(5, 0, 0),
      new THREE.Vector3(-5, 0, 0),
      new THREE.Vector3(0, 0, 5),
      new THREE.Vector3(0, 0, -5),
      new THREE.Vector3(4, 0, 4),
      new THREE.Vector3(-4, 0, 4),
      new THREE.Vector3(4, 0, -4),
      new THREE.Vector3(-4, 0, -4),
    ];
    this.targetPoint = new THREE.Vector3(0, 0, 0); // Crystal's approximate center
  }

  tick(delta, elapsedGameTime) {
    if (APP.enemies.length < APP.MAX_ACTIVE_DEMONS && elapsedGameTime - this.lastSpawnTime > this.spawnInterval) {
      this.spawnEnemy();
      this.lastSpawnTime = elapsedGameTime;
    }
  }

  spawnEnemy() {
    const randomSpawnPoint = this.spawnPoints[Math.floor(Math.random() * this.spawnPoints.length)];
    // Create a new enemy using the pre-loaded demon model
    const newDemon = new Enemy(
      APP.DEMON_MODEL.scene.clone(), // Clone the model to create new instances
      randomSpawnPoint,
      this.targetPoint,
      APP.BASE_DEMON_SPEED
    );
    APP.enemies.push(newDemon);
  }
}

// Manages spell effects and visuals.
class SpellEffect {
  constructor(type, position, duration) {
    this.type = type;
    this.position = position;
    this.duration = duration;
    this.elapsed = 0;
    this.isActive = true;

    // Create a visual representation of the spell (e.g., a sphere of light)
    const geometry = new THREE.SphereGeometry(0.2, 16, 16);
    let color;
    switch (type) {
      case 'arcane': color = 0x9BCFFF; break; // Blue
      case 'fire': color = 0xF2C092; break; // Orange
      case 'vortex': color = 0xC5F298; break; // Green
      default: color = 0xFFFFFF; break;
    }
    const material = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.8 });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.copy(position);
    APP.scene.add(this.mesh);

    // Add a point light to the spell effect
    this.light = new THREE.PointLight(color, 2, 5);
    this.light.position.copy(position);
    APP.scene.add(this.light);

    // Initial scale animation
    gsap.fromTo(this.mesh.scale, { x: 0.1, y: 0.1, z: 0.1 }, { x: 1, y: 1, z: 1, duration: 0.3 });
    gsap.fromTo(this.light, { intensity: 0 }, { intensity: 2, duration: 0.3 });

    APP.spellLights.push(this); // Add to active spells array
  }

  tick(delta) {
    if (!this.isActive) return;

    this.elapsed += delta;
    const progress = this.elapsed / this.duration;

    // Fade out the spell effect
    this.mesh.material.opacity = 0.8 * (1 - progress);
    this.light.intensity = 2 * (1 - progress);

    if (this.elapsed >= this.duration) {
      this.isActive = false;
      this.dispose();
    }
  }

  dispose() {
    APP.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    APP.scene.remove(this.light);
    this.light.dispose();
    APP.spellLights = APP.spellLights.filter(s => s !== this);
  }
}


// --- CORE GAME LOGIC ---

const Game = {
  init() {
    this.setupThreeJS();
    this.setupPostProcessing();
    this.setupModels();
    this.setupAudio();
    this.setupUI();
    this.setupXState();
    this.setupEventHandlers();

    if (APP.DEBUG_PANELS) {
      this.setupStats();
    }

    // Start the game loop after window has loaded
    window.onload = () => {
      this.tick();
      // Initially transition to the LOADING state
      APP.machine.send("LOADED"); // Simulate loaded after models are in memory
    };
  },

  setupThreeJS() {
    const canvasContainer = document.querySelector(".canvas");
    APP.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    APP.renderer.setSize(canvasContainer.clientWidth, canvasContainer.clientHeight);
    APP.renderer.setPixelRatio(window.devicePixelRatio); // For sharp rendering on high-DPI screens
    APP.renderer.setClearColor(0x000000, 0); // Transparent background
    canvasContainer.appendChild(APP.renderer.domElement);

    APP.scene = new THREE.Scene();
    APP.camera = new THREE.PerspectiveCamera(
      75,
      canvasContainer.clientWidth / canvasContainer.clientHeight,
      0.1,
      1000
    );
    APP.camera.position.set(0, 1.5, 3); // Adjust camera position

    // Add ambient light
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    APP.scene.add(ambientLight);

    // Add a directional light for shadows
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 10, 5);
    directionalLight.castShadow = true;
    APP.scene.add(directionalLight);

    window.addEventListener("resize", this.onWindowResize.bind(this), false);
  },

  setupPostProcessing() {
    APP.composer = new EffectComposer(APP.renderer);
    APP.composer.addPass(new RenderPass(APP.scene, APP.camera));

    // Add custom glow shader for a subtle effect
    const glowPass = new ShaderPass(GlowShader);
    APP.composer.addPass(glowPass);
  },

  setupModels() {
    APP.gltfLoader = new GLTFLoader();

    // Load Room Model
    APP.gltfLoader.load(
      "https://assets.codepen.io/557388/room_01.glb",
      (gltf) => {
        APP.stage = new Stage(gltf.scene);
        APP.stage.model.traverse((node) => {
          if (node.isMesh) {
            node.castShadow = true;
            node.receiveShadow = true;
          }
        });
        console.log("Room model loaded:", APP.stage);
        APP.machine.send("MODELS_LOADED"); // Notify XState that models are loaded
      },
      undefined,
      (error) => {
        console.error("Error loading room model:", error);
        APP.machine.send("LOAD_ERROR");
      }
    );

    // Load Crystal Model
    APP.gltfLoader.load(
      "https://assets.codepen.io/557388/crystal_01.glb",
      (gltf) => {
        APP.crystal = new Crystal(gltf.scene);
        APP.CRYSTAL_COLOR = new THREE.Color(0xd54adf); // Define crystal color
        console.log("Crystal model loaded:", APP.crystal);
      },
      undefined,
      (error) => {
        console.error("Error loading crystal model:", error);
        APP.machine.send("LOAD_ERROR");
      }
    );

    // Load Demon Model
    APP.gltfLoader.load(
      "https://assets.codepen.io/557388/demon_01.glb",
      (gltf) => {
        APP.DEMON_MODEL = gltf; // Store the GLTF object for cloning
        APP.DEMON_MODEL.scene.traverse((node) => {
          if (node.isMesh) {
            node.castShadow = true;
            node.receiveShadow = true;
          }
        });
        console.log("Demon model loaded:", APP.DEMON_MODEL);
      },
      undefined,
      (error) => {
        console.error("Error loading demon model:", error);
        APP.machine.send("LOAD_ERROR");
      }
    );

    // Load Hand Model (Player's Hand)
    APP.gltfLoader.load(
      "https://assets.codepen.io/557388/hand_01.glb",
      (gltf) => {
        APP.hand = new GameObject(gltf.scene);
        APP.hand.model.position.set(0, 0.5, 1.5); // Position the hand
        APP.hand.model.scale.set(0.01, 0.01, 0.01); // Initial scale for animation
        APP.hand.model.traverse((node) => {
          if (node.isMesh) {
            node.castShadow = true;
            node.receiveShadow = true;
          }
        });
        APP.mixer = new THREE.AnimationMixer(gltf.scene);
        gltf.animations.forEach((clip) => {
          APP.actions[clip.name] = APP.mixer.clipAction(clip);
        });
        console.log("Hand model loaded:", APP.hand);
        // Animate hand in
        gsap.to(APP.hand.model.scale, { x: 0.1, y: 0.1, z: 0.1, duration: 1, ease: "elastic.out(1, 0.5)" });
      },
      undefined,
      (error) => {
        console.error("Error loading hand model:", error);
        APP.machine.send("LOAD_ERROR");
      }
    );
  },

  setupAudio() {
    Howler.volume(0.5); // Global volume

    APP.audio.music = new Howl({
      src: ["https://assets.codepen.io/557388/music.mp3"],
      loop: true,
      volume: 0.3,
    });

    APP.audio.hit = new Howl({
      src: ["https://assets.codepen.io/557388/hit.mp3"],
      volume: 0.8,
    });

    APP.audio.spellCast = new Howl({
      src: ["https://assets.codepen.io/557388/spell_cast.mp3"],
      volume: 0.7,
    });

    APP.audio.gameOver = new Howl({
      src: ["https://assets.codepen.io/557388/game_over.mp3"],
      volume: 0.7,
    });

    APP.audio.win = new Howl({
      src: ["https://assets.codepen.io/557388/win.mp3"],
      volume: 0.7,
    });
  },

  startMusic() {
    if (!APP.audio.music.playing()) {
      APP.audio.music.play();
    }
  },

  stopMusic() {
    if (APP.audio.music.playing()) {
      APP.audio.music.stop();
    }
  },

  // UI Setup (already largely covered in previous responses, but ensure dynamic updates)
  setupUI() {
    APP.ui.screens = document.querySelectorAll('[data-screen]');
    APP.ui.topBarElements = document.querySelectorAll('[data-show-on]');
    APP.ui.buttons = document.querySelectorAll('button[data-send]');
    APP.ui.healthBar = document.querySelector('.health-bar::after'); // Use ::after for visual bar
    APP.ui.demonCount = document.querySelector('[data-demon-count]');
    APP.ui.demonTotal = document.querySelector('[data-demon-total]');
    APP.ui.spellGuide = document.getElementById('spell-guide'); // For instruction screen
    APP.ui.spellStats = document.getElementById('spell-stats');
    APP.ui.fpsPanel = document.getElementById('fps');
    APP.ui.healthStatesPanel = document.getElementById('health-states');
    APP.ui.appStatePanel = document.getElementById('app-state');
    APP.ui.endlessModePanel = document.getElementById('endless-mode');
  },

  updateUI(newState) {
    // Hide all screens initially
    APP.ui.screens.forEach(screen => {
      screen.classList.remove('active');
      // Reset fade-in elements for re-animation
      screen.querySelectorAll('[data-fade]').forEach(el => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(20px)';
      });
    });

    // Show the active screen and trigger fade-in animations
    const activeScreen = document.querySelector(`[data-screen="${newState}"]`);
    if (activeScreen) {
      activeScreen.classList.add('active');
      // Force reflow to restart CSS transitions for data-fade elements
      void activeScreen.offsetWidth;
      gsap.to(activeScreen.querySelectorAll('[data-fade]'), {
          opacity: 1,
          y: 0,
          stagger: 0.1, // Stagger effect for elements with data-fade
          duration: 0.5,
          ease: "power2.out"
      });
      // Handle split text animations
      gsap.to(activeScreen.querySelectorAll('[data-split]'), {
          opacity: 1,
          y: 0,
          stagger: 0.05,
          duration: 0.3,
          ease: "power2.out"
      });
    }

    // Update top bar elements visibility
    APP.ui.topBarElements.forEach(element => {
      const showOnStates = element.dataset.showOn ? element.dataset.showOn.split(',') : [];
      if (showOnStates.includes(newState)) {
        element.style.display = 'flex'; // Use flex for these elements
      } else {
        element.style.display = 'none';
      }
    });

    // Update debug panels
    if (APP.DEBUG_PANELS) {
        APP.ui.fpsPanel.style.display = 'block';
        APP.ui.healthStatesPanel.style.display = 'block';
        APP.ui.appStatePanel.style.display = 'block';
        APP.ui.endlessModePanel.style.display = 'block';
        document.querySelector('#app-state .state').textContent = `State: ${newState}`;
    } else {
        APP.ui.fpsPanel.style.display = 'none';
        APP.ui.healthStatesPanel.style.display = 'none';
        APP.ui.appStatePanel.style.display = 'none';
        APP.ui.endlessModePanel.style.display = 'none';
    }

    // Specific UI updates based on state
    if (newState === 'INSTRUCTIONS_CAST') {
        APP.ui.spellGuide.classList.add('show');
    } else {
        APP.ui.spellGuide.classList.remove('show');
    }

    // Hide spell stats panel unless in SPELL_OVERLAY state
    if (newState === 'SPELL_OVERLAY' || newState === 'ENDLESS_SPELL_OVERLAY') {
        APP.ui.spellStats.style.display = 'block';
    } else {
        APP.ui.spellStats.style.display = 'none';
    }
  },

  setupEventHandlers() {
    APP.ui.buttons.forEach(button => {
      button.addEventListener('click', () => {
        const action = button.dataset.send;
        APP.machine.send(action.toUpperCase()); // Send action to XState machine
      });
    });

    // Spell drawing functionality
    const spellHelper = document.getElementById('spell-helper');
    const spellPath = document.getElementById('spell-path');
    const spellPoints = document.getElementById('spell-points');
    let drawing = false;
    let points = [];

    function getCoords(event) {
      if (event.touches) {
        return { x: event.touches[0].clientX, y: event.touches[0].clientY };
      }
      return { x: event.clientX, y: event.clientY };
    }

    const startDrawing = (e) => {
      if (APP.machine.state.matches('game_running') || APP.machine.state.matches('endless_mode')) {
        drawing = true;
        points = [];
        const coords = getCoords(e);
        points.push(coords);
        if (APP.DEBUG_OVERLAYS) {
            spellHelper.style.display = 'block';
        }
        e.preventDefault(); // Prevent scrolling on touch
      }
    };

    const draw = (e) => {
      if (drawing) {
        const coords = getCoords(e);
        points.push(coords);
        updateSpellPath();
        e.preventDefault(); // Prevent scrolling on touch
      }
    };

    const endDrawing = () => {
      if (drawing) {
        drawing = false;
        processSpell();
        if (APP.DEBUG_OVERLAYS) {
            spellHelper.style.display = 'none';
        }
        clearSpellPath();
      }
    };

    document.addEventListener('mousedown', startDrawing);
    document.addEventListener('touchstart', startDrawing, { passive: false });
    document.addEventListener('mousemove', draw);
    document.addEventListener('touchmove', draw, { passive: false });
    document.addEventListener('mouseup', endDrawing);
    document.addEventListener('touchend', endDrawing);

    function updateSpellPath() {
      if (points.length < 2) return;

      let pathData = `M ${points[0].x} ${points[0].y}`;
      for (let i = 1; i < points.length; i++) {
        pathData += ` L ${points[i].x} ${points[i].y}`;
      }
      if (spellPath) {
        spellPath.setAttribute('d', pathData);
        if (APP.DEBUG_OVERLAYS) {
            spellPoints.innerHTML = '';
            points.forEach(p => {
                const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
                circle.setAttribute('cx', p.x);
                circle.setAttribute('cy', p.y);
                circle.setAttribute('r', 2);
                circle.setAttribute('fill', 'red');
                spellPoints.appendChild(circle);
            });
        }
      }
    }

    function clearSpellPath() {
      if (spellPath) spellPath.setAttribute('d', '');
      if (spellPoints) spellPoints.innerHTML = '';
      points = [];
    }

    function processSpell() {
      // Basic spell recognition based on path length for demonstration
      // In a real game, you'd use a more sophisticated algorithm (e.g., stroke matching)
      if (points.length > 50) { // Arbitrary threshold for a "valid" drawing
        APP.audio.spellCast.play();
        const randomSpellType = ['arcane', 'fire', 'vortex'][Math.floor(Math.random() * 3)];
        new SpellEffect(randomSpellType, APP.crystal.model.position, 1.5); // Spawn effect at crystal
        
        // Kill some random demons based on spell type
        let demonsToKill = 0;
        if (randomSpellType === 'arcane' && APP.enemies.length > 0) {
            demonsToKill = 1;
        } else if (randomSpellType === 'fire' && APP.enemies.length > 0) {
            demonsToKill = 2;
        } else if (randomSpellType === 'vortex' && APP.enemies.length > 0) {
            demonsToKill = Math.min(APP.enemies.length, 5); // Kill up to 5 for vortex
        }

        for (let i = 0; i < demonsToKill; i++) {
            if (APP.enemies.length > 0) {
                const demonIndex = Math.floor(Math.random() * APP.enemies.length);
                APP.enemies[demonIndex].hit();
                APP.enemies.splice(demonIndex, 1); // Remove from active enemies array
                APP.audio.hit.play();
            }
        }
        console.log(`Casting ${randomSpellType} spell! Killed ${demonsToKill} demons.`);
      } else {
        console.log("Drawing too short to be a spell.");
      }
    }
  },

  setupXState() {
    // Define the game state machine
    const gameMachine = createMachine({
      id: "game",
      initial: "loading",
      context: {
        loadingProgress: 0,
      },
      states: {
        loading: {
          on: {
            // After all models are loaded, transition to title screen
            MODELS_LOADED: {
              target: "titleScreen",
              actions: () => console.log("All models loaded!"),
            },
            LOAD_ERROR: {
              target: "loadError",
              actions: () => console.error("Asset loading failed!"),
            },
          },
          // Simulate loading progress
          after: {
            2000: { // Simulate 2 seconds loading before checking for models_loaded
                target: "titleScreen", // Force transition to title screen after 2s if MODELS_LOADED not sent
                cond: (context) => context.loadingProgress === 0 // Only if no models have explicitly loaded
            }
          }
        },
        loadError: {
          type: "final", // A final state, indicates an error has occurred
        },
        titleScreen: {
          entry: ["stopMusic", "resetGame", "updateUI"],
          on: {
            NEXT: "instructionsCrystal",
            SKIP: "gameRunning",
            ENDLESS: "endlessMode",
            CREDITS: "credits",
          },
        },
        instructionsCrystal: {
          entry: "updateUI",
          on: {
            NEXT: "instructionsDemon",
          },
        },
        instructionsDemon: {
          entry: "updateUI",
          on: {
            NEXT: "instructionsCast",
          },
        },
        instructionsCast: {
          entry: "updateUI",
          on: {
            NEXT: "instructionsSpells",
          },
        },
        instructionsSpells: {
          entry: "updateUI",
          on: {
            NEXT: "gameRunning",
          },
        },
        gameRunning: {
          entry: ["startMusic", "startGame", "updateUI"],
          on: {
            PAUSE: "paused",
            END: "gameOver", // In regular mode, ending means game over (e.g., if you quit)
            SPELLS: "spellOverlay",
          },
          always: [
            { target: "winner", cond: "isGameWon" },
            { target: "gameOver", cond: "isGameOver" },
          ],
        },
        endlessMode: {
          entry: ["startMusic", "startEndlessMode", "updateUI"],
          on: {
            PAUSE: "endlessPause",
            END: "titleScreen", // In endless mode, ending returns to title
            SPELLS: "endlessSpellOverlay",
          },
          always: [
            { target: "gameOver", cond: "isGameOver" },
          ],
        },
        paused: {
          entry: ["updateUI"],
          on: {
            RESUME: "gameRunning",
            END: "titleScreen",
          },
        },
        endlessPause: {
          entry: ["updateUI"],
          on: {
            RESUME: "endlessMode",
            END: "titleScreen",
          },
        },
        spellOverlay: {
          entry: ["updateUI"],
          on: {
            CLOSE: "gameRunning",
          },
        },
        endlessSpellOverlay: {
          entry: ["updateUI"],
          on: {
            CLOSE: "endlessMode",
          },
        },
        gameOver: {
          entry: ["stopMusic", "playGameOverSound", "updateUI"],
          on: {
            RESTART: "titleScreen",
            INSTRUCTIONS: "instructionsCrystal",
            ENDLESS: "endlessMode",
            CREDITS: "credits",
          },
        },
        winner: {
          entry: ["stopMusic", "playWinSound", "updateUI"],
          on: {
            RESTART: "titleScreen",
            INSTRUCTIONS: "instructionsCrystal",
            ENDLESS: "endlessMode",
            CREDITS: "credits",
          },
        },
        credits: {
          entry: "updateUI",
          on: {
            CLOSE: "titleScreen",
          },
        },
      },
    }, {
        guards: {
            isGameWon: (context) => APP.demonsKilled >= APP.DEMONS_TO_KILL && !APP.isEndlessMode,
            isGameOver: (context) => APP.health <= 0,
        },
        actions: {
            updateUI: (context, event) => Game.updateUI(event.type === 'xstate.init' ? gameMachine.initialState.value : gameMachine.transition(context, event).value),
            startMusic: () => Game.startMusic(),
            stopMusic: () => Game.stopMusic(),
            playGameOverSound: () => APP.audio.gameOver.play(),
            playWinSound: () => APP.audio.win.play(),
            resetGame: () => Game.resetGame(),
            startGame: () => Game.startGame(),
            startEndlessMode: () => Game.startEndlessMode(),
        }
    });

    APP.machine = interpret(gameMachine).onTransition((state) => {
      // When the state changes, update the UI
      console.log("State changed to:", state.value);
      Game.updateUI(state.value);
    });

    APP.machine.start();

    // Initial sign-in with Firebase to allow data persistence (even if not explicitly used yet)
    // This part is for Canvas environment integration
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};

    // Only initialize Firebase if config is available
    if (Object.keys(firebaseConfig).length > 0) {
        // dynamic import firebase modules to prevent breaking if not present
        import('https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js')
        .then(module => {
            const { initializeApp } = module;
            const firebaseApp = initializeApp(firebaseConfig);
            return import('https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js')
                .then(authModule => {
                    const { getAuth, signInWithCustomToken, signInAnonymously } = authModule;
                    const auth = getAuth(firebaseApp);
                    if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
                        return signInWithCustomToken(auth, __initial_auth_token);
                    } else {
                        return signInAnonymously(auth);
                    }
                });
        })
        .then(userCredential => {
            console.log("Firebase auth successful:", userCredential.user.uid);
        })
        .catch(error => {
            console.error("Firebase auth error:", error);
        });
    } else {
        console.warn("Firebase config not available. Skipping Firebase initialization.");
    }
  },

  resetGame() {
    APP.health = 1;
    APP.demonsKilled = 0;
    APP.elapsedGameTime = 0;
    APP.enemies.forEach(enemy => enemy.dispose());
    APP.enemies = [];
    APP.isEndlessMode = false;
    APP.rotationSpeed = APP.targetRotationSpeed; // Reset rotation speed
    if (APP.stage) {
        APP.stage.everything.rotation.y = 0; // Reset stage rotation
    }
    // Update health bar display
    document.documentElement.style.setProperty('--health', APP.health);
    APP.ui.demonCount.textContent = APP.demonsKilled;
    APP.ui.demonTotal.textContent = APP.DEMONS_TO_KILL;
  },

  startGame() {
    Game.resetGame();
    APP.isPlaying = true;
    APP.enemySpawner = new EnemySpawner();
    APP.ui.demonTotal.textContent = APP.DEMONS_TO_KILL;
    APP.isEndlessMode = false;
  },

  startEndlessMode() {
    Game.resetGame();
    APP.health = APP.ENDLESS_MODE_START_HEALTH;
    APP.isPlaying = true;
    APP.enemySpawner = new EnemySpawner();
    APP.ui.demonTotal.textContent = "∞"; // Infinity symbol for endless
    APP.isEndlessMode = true;
  },

  tick() {
    const currentTime = performance.now() / 1000; // Convert to seconds
    const delta = APP.lastFrameTime ? currentTime - APP.lastFrameTime : 0;
    APP.lastFrameTime = currentTime;

    // Update elapsed game time only when playing
    if (APP.isPlaying) {
      APP.elapsedGameTime += delta;

      // Update health and decay
      APP.health += APP.HEALTH_REPLENISH_RATE * delta;
      APP.health -= APP.enemies.length * (APP.HEALTH_DECAY_RATE * delta);
      APP.health = Math.min(1, Math.max(0, APP.health)); // Clamp health between 0 and 1
      document.documentElement.style.setProperty('--health', APP.health); // Update CSS variable for health bar

      // Check for game over condition
      if (APP.health <= 0) {
        APP.machine.send("GAME_OVER");
      }

      // Update demons killed count
      APP.ui.demonCount.textContent = APP.demonsKilled;

      // Update enemy spawner (if playing)
      if (APP.enemySpawner) {
        APP.enemySpawner.tick(delta, APP.elapsedGameTime);
      }

      // Update individual enemies
      for (let i = APP.enemies.length - 1; i >= 0; i--) {
        const enemy = APP.enemies[i];
        enemy.tick(delta);
        if (!enemy.isActive) {
          APP.enemies.splice(i, 1); // Remove inactive enemies
        }
      }

      // Update spell effects
      for (let i = APP.spellLights.length - 1; i >= 0; i--) {
        APP.spellLights[i].tick(delta);
      }

      // Check win condition for non-endless mode
      if (!APP.isEndlessMode && APP.demonsKilled >= APP.DEMONS_TO_KILL && APP.enemies.length === 0) {
        APP.machine.send("WIN"); // Use WIN event for victory
      }
    }

    // Rotate the stage if APP.rotating is true
    if (APP.rotating && APP.stage && APP.stage.everything) {
      APP.stage.everything.rotation.y += APP.rotationSpeed * delta;
      APP.stage.everything.rotation.y %= Math.PI * 2; // Keep rotation within 0-2PI
    }

    // Update Three.js animations (if mixers are present)
    if (APP.mixer) {
      APP.mixer.update(delta);
    }

    // Render the scene
    if (APP.composer) {
      APP.composer.render();
    } else if (APP.renderer && APP.scene && APP.camera) {
      APP.renderer.render(APP.scene, APP.camera);
    }

    // Update stats panel
    if (APP.stats) {
      APP.stats.end();
      APP.stats.begin();
    }

    // Request next animation frame
    requestAnimationFrame(this.tick.bind(this));
  },

  onWindowResize() {
    const canvasContainer = document.querySelector(".canvas");
    if (canvasContainer && APP.camera && APP.renderer) {
      APP.camera.aspect = canvasContainer.clientWidth / canvasContainer.clientHeight;
      APP.camera.updateProjectionMatrix();
      APP.renderer.setSize(canvasContainer.clientWidth, canvasContainer.clientHeight);
      if (APP.composer) {
        APP.composer.setSize(canvasContainer.clientWidth, canvasContainer.clientHeight);
      }
    }
  },

  setupStats() {
    APP.stats = new Stats();
    APP.stats.showPanel(0); // 0: fps, 1: ms, 2: mb, 3+: custom
    document.body.appendChild(APP.stats.dom);
    APP.stats.dom.style.cssText = 'position:absolute;top:0px;left:0px; display:none;'; // Initially hidden
    // Ensure the debug panels are displayed when DEBUG_PANELS is true
    if (APP.DEBUG_PANELS) {
        APP.stats.dom.style.display = 'block';
    }
  },
};

// Initialize the game
Game.init();
