document.addEventListener('DOMContentLoaded', () => {
    // --- Canvas & Context ---
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');

    // --- DOM Elements ---
    const screens = {
        mainMenu: document.getElementById('main-menu'),
        difficulty: document.getElementById('difficulty-screen'),
        shop: document.getElementById('shop-screen'),
        missions: document.getElementById('missions-screen')
    };
    const hud = {
        container: document.getElementById('hud-container'),
        score: document.getElementById('score'),
        dataBits: document.getElementById('data-bits'),
        powerupStatus: document.getElementById('powerup-status'),
        highscore: document.getElementById('highscore-display')
    };
    const shopItemsContainer = document.getElementById('shop-items');
    const playerDataBitsDisplay = document.getElementById('player-data-bits');
    const missionsList = document.getElementById('missions-list');

    // --- Game State ---
    let gameState = 'menu'; // menu, playing, gameover
    let score = 0;
    let frame = 0;

    // --- Player Data (Loaded from localStorage) ---
    const playerData = {
        dataBits: parseInt(localStorage.getItem('playerDataBits')) || 0,
        highscore: parseInt(localStorage.getItem('playerHighscore')) || 0,
        unlockedSkins: JSON.parse(localStorage.getItem('unlockedSkins')) || ['default'],
        equippedSkin: localStorage.getItem('equippedSkin') || 'default',
        missions: JSON.parse(localStorage.getItem('missions')) || {}
    };

    function saveData() {
        localStorage.setItem('playerDataBits', playerData.dataBits);
        localStorage.setItem('playerHighscore', playerData.highscore);
        localStorage.setItem('unlockedSkins', JSON.stringify(playerData.unlockedSkins));
        localStorage.setItem('equippedSkin', playerData.equippedSkin);
        localStorage.setItem('missions', JSON.stringify(playerData.missions));
    }

    // --- Game Settings ---
    const difficulties = {
        easy:   { gravity: 0.4, lift: -8,  obstacleGap: 250, obstacleSpeed: 3, obstacleInterval: 130, movingObstacleChance: 0.1 },
        normal: { gravity: 0.5, lift: -9,  obstacleGap: 220, obstacleSpeed: 4, obstacleInterval: 110, movingObstacleChance: 0.3 },
        hard:   { gravity: 0.6, lift: -10, obstacleGap: 200, obstacleSpeed: 5, obstacleInterval: 90,  movingObstacleChance: 0.5 }
    };
    let settings;

    // --- Game Objects ---
    const drone = { x: 0, y: 0, width: 40, height: 30, velocity: 0, shield: false, slowmo: 0 };
    let obstacles = [];
    let particles = [];
    let powerups = [];
    let dataBitCoins = [];
    let backgroundStars = [];
    let backgroundBuildings = [];
    let sessionStats = {};

    // --- Skins Definition ---
    const skins = {
        'default': {
            price: 0,
            draw: (drwCtx, x, y, w, h, hasShield) => {
                drwCtx.fillStyle = '#0ff';
                drwCtx.fillRect(x, y, w, h);
                if (hasShield) {
                    drwCtx.strokeStyle = '#00ffff';
                    drwCtx.lineWidth = 3;
                    drwCtx.strokeRect(x - 5, y - 5, w + 10, h + 10);
                }
            }
        },
        'enforcer': {
            price: 250,
            draw: (drwCtx, x, y, w, h, hasShield) => {
                drwCtx.fillStyle = '#333'; // Body
                drwCtx.fillRect(x, y, w, h);
                drwCtx.fillStyle = '#D4AF37'; // Gold accents
                drwCtx.fillRect(x + w * 0.2, y, w * 0.6, h * 0.2); // Visor area
                drwCtx.fillStyle = '#f0f'; // Neon detail
                drwCtx.fillRect(x, y + h * 0.8, w, h * 0.1);
                if (hasShield) {
                    drwCtx.strokeStyle = '#f0f';
                    drwCtx.lineWidth = 3;
                    drwCtx.strokeRect(x - 5, y - 5, w + 10, h + 10);
                }
            }
        }
    };
    
    // --- Audio ---
    let audioCtx;
    function initAudio() {
        if (audioCtx) return;
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    function playSound(type) {
        if (!audioCtx) return;
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.connect(g).connect(audioCtx.destination);
        g.gain.setValueAtTime(0.2, audioCtx.currentTime);
        if (type === 'lift') { o.type = 'triangle'; o.frequency.setValueAtTime(300, audioCtx.currentTime); o.frequency.exponentialRampToValueAtTime(600, audioCtx.currentTime + 0.1); }
        else if (type === 'score') { o.type = 'sine'; o.frequency.setValueAtTime(800, audioCtx.currentTime); }
        else if (type === 'crash') { o.type = 'sawtooth'; o.frequency.setValueAtTime(400, audioCtx.currentTime); o.frequency.exponentialRampToValueAtTime(50, audioCtx.currentTime + 0.4); }
        else if (type === 'powerup') { o.type = 'square'; o.frequency.setValueAtTime(1000, audioCtx.currentTime); }
        else if (type === 'coin') { o.type = 'sine'; o.frequency.setValueAtTime(1500, audioCtx.currentTime); g.gain.setValueAtTime(0.1, audioCtx.currentTime); }
        g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.2);
        o.start(); o.stop(audioCtx.currentTime + 0.25);
    }

    // --- Missions ---
    const missionDefs = {
        'score10': { description: 'Reach a score of 10', reward: 20, check: (stats) => stats.score >= 10 },
        'score50': { description: 'Reach a score of 50', reward: 100, check: (stats) => stats.score >= 50 },
        'collect5': { description: 'Collect 5 Data-Bits in one game', reward: 15, check: (stats) => stats.bitsCollected >= 5 },
        'useShield': { description: 'Use a Shield power-up', reward: 10, check: (stats) => stats.shieldsUsed > 0 }
    };

    // =========================================================================
    //                                  UI & MENUS
    // =========================================================================
    function switchScreen(screenName) {
        Object.values(screens).forEach(s => s.style.display = 'none');
        if (screens[screenName]) {
            screens[screenName].style.display = 'block';
        }
    }

    function setupUI() {
        document.getElementById('start-game-btn').onclick = () => switchScreen('difficulty');
        document.getElementById('shop-btn').onclick = () => {
            populateShop();
            switchScreen('shop');
        };
        document.getElementById('missions-btn').onclick = () => {
            populateMissions();
            switchScreen('missions');
        };
        document.querySelectorAll('.back-btn').forEach(btn => {
            btn.onclick = () => switchScreen(btn.dataset.target);
        });
        document.getElementById('difficulty-selector').onclick = (e) => {
            if (e.target.tagName === 'BUTTON') {
                settings = difficulties[e.target.dataset.difficulty];
                startGame();
            }
        };
        hud.highscore.textContent = `HIGHSCORE: ${playerData.highscore}`;
    }

    function populateShop() {
        shopItemsContainer.innerHTML = '';
        playerDataBitsDisplay.textContent = `Your Data-Bits: ${playerData.dataBits}`;

        for (const id in skins) {
            const skin = skins[id];
            const isUnlocked = playerData.unlockedSkins.includes(id);
            const isEquipped = playerData.equippedSkin === id;

            const itemEl = document.createElement('div');
            itemEl.className = 'shop-item';
            itemEl.innerHTML = `<div class="skin-preview" id="preview-${id}"></div><div>${id.charAt(0).toUpperCase() + id.slice(1)}</div><button id="btn-${id}"></button>`;
            shopItemsContainer.appendChild(itemEl);

            const btn = document.getElementById(`btn-${id}`);
            if (isEquipped) {
                btn.textContent = 'Equipped';
                btn.disabled = true;
                btn.className = 'equipped';
            } else if (isUnlocked) {
                btn.textContent = 'Equip';
                btn.onclick = () => {
                    playerData.equippedSkin = id;
                    saveData();
                    populateShop();
                };
            } else {
                btn.textContent = `Buy (${skin.price} bits)`;
                if (playerData.dataBits < skin.price) {
                    btn.disabled = true;
                }
                btn.onclick = () => {
                    if (playerData.dataBits >= skin.price) {
                        playerData.dataBits -= skin.price;
                        playerData.unlockedSkins.push(id);
                        saveData();
                        populateShop();
                    }
                };
            }
            
            const previewCanvas = document.createElement('canvas');
            previewCanvas.width = 80;
            previewCanvas.height = 80;
            const previewCtx = previewCanvas.getContext('2d');
            skins[id].draw(previewCtx, 20, 25, 40, 30, false); // Draw preview without shield
            document.getElementById(`preview-${id}`).appendChild(previewCanvas);
        }
    }

    function populateMissions() {
        missionsList.innerHTML = '';
        for (const id in missionDefs) {
            const mission = missionDefs[id];
            const isCompleted = playerData.missions[id];
            const li = document.createElement('li');
            li.textContent = `${mission.description} (Reward: ${mission.reward} bits)`;
            if (isCompleted) {
                li.className = 'completed';
            }
            missionsList.appendChild(li);
        }
    }

    // =========================================================================
    //                                  GAME LOGIC
    // =========================================================================
    function startGame() {
        initAudio();
        resetGameState();
        gameState = 'playing';
        switchScreen('none');
        hud.container.style.opacity = 1;
    }

    function resetGameState() {
        score = 0;
        frame = 0;
        drone.y = canvas.height / 2;
        drone.velocity = 0;
        drone.shield = false;
        drone.slowmo = 0;
        obstacles = [];
        powerups = [];
        dataBitCoins = [];
        particles = [];
        sessionStats = { score: 0, bitsCollected: 0, shieldsUsed: 0 };
        hud.score.textContent = `SCORE: 0`;
        hud.dataBits.textContent = `DATA-BITS: ${playerData.dataBits}`;
        hud.powerupStatus.textContent = '';
    }

    function gameOver() {
        if (gameState !== 'playing') return;
        playSound('crash');
        gameState = 'gameover';
        
        sessionStats.score = score;
        checkMissions();

        if (score > playerData.highscore) {
            playerData.highscore = score;
        }
        saveData();
        
        hud.container.style.opacity = 0;
        hud.highscore.textContent = `HIGHSCORE: ${playerData.highscore}`;
        
        setTimeout(() => {
            gameState = 'menu';
            switchScreen('mainMenu');
        }, 1500);
    }

    // =========================================================================
    //                             UPDATE FUNCTIONS
    // =========================================================================
    function updateGame(gameSpeed) {
        updateDrone();
        updateObstacles(gameSpeed);
        updatePowerups(gameSpeed);
        updateDataBits(gameSpeed);
        updateParticles();
        checkCollisions();
        frame++;
    }

    function updateDrone() {
        drone.velocity += settings.gravity;
        drone.y += drone.velocity;
        if (Math.random() > 0.5) createParticle(drone.x, drone.y + drone.height / 2, '#f0f', 2);
    }

    function updateObstacles(speed) {
        if (frame % settings.obstacleInterval === 0) {
            const topHeight = Math.random() * (canvas.height / 2 - settings.obstacleGap / 2) + 80;
            const moving = Math.random() < settings.movingObstacleChance;
            obstacles.push({ x: canvas.width, width: 60, top: topHeight, bottom: canvas.height - topHeight - settings.obstacleGap, passed: false, moving: moving, moveDir: 1 });
        }
        obstacles.forEach(o => {
            o.x -= speed;
            if (o.moving) {
                o.top += o.moveDir;
                o.bottom -= o.moveDir;
                if (o.top < 50 || o.top > canvas.height / 2 - 50) o.moveDir *= -1;
            }
        });
        obstacles = obstacles.filter(o => o.x + o.width > 0);
    }

    function updatePowerups(speed) {
        if (frame > 0 && frame % 500 === 0) {
            const type = Math.random() > 0.5 ? 'shield' : 'slowmo';
            powerups.push({ x: canvas.width, y: Math.random() * (canvas.height - 200) + 100, size: 25, type: type });
        }
        powerups.forEach(p => p.x -= speed);
        powerups = powerups.filter(p => p.x + p.size > 0);
    }

    function updateDataBits(speed) {
        if (frame > 0 && frame % 150 === 0) {
            dataBitCoins.push({ x: canvas.width, y: Math.random() * (canvas.height - 200) + 100, size: 15 });
        }
        dataBitCoins.forEach(c => c.x -= speed);
        dataBitCoins = dataBitCoins.filter(c => c.x + c.size > 0);
    }

    function updateParticles() {
        for (let i = particles.length - 1; i >= 0; i--) {
            let p = particles[i];
            p.x -= p.velocity.x;
            p.y -= p.velocity.y;
            p.life--;
            if (p.life <= 0) particles.splice(i, 1);
        }
    }
    
    function updateBackground(speed) {
        backgroundStars.forEach(s => { s.x -= s.speed * (speed / 5); if (s.x < 0) s.x = canvas.width; });
        backgroundBuildings.forEach(b => { b.x -= b.speed * (speed / 5); if (b.x + b.width < 0) b.x = canvas.width; });
    }

    // =========================================================================
    //                              DRAW FUNCTIONS
    // =========================================================================
    function drawGame() {
        skins[playerData.equippedSkin].draw(ctx, drone.x, drone.y, drone.width, drone.height, drone.shield);
        drawObstacles();
        drawPowerups();
        drawDataBits();
        drawParticles();
    }

    function drawBackground() {
        ctx.fillStyle = '#02021a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#FFF';
        backgroundStars.forEach(s => { ctx.globalAlpha = s.speed * 2; ctx.fillRect(s.x, s.y, s.size, s.size); });
        ctx.globalAlpha = 1;
        backgroundBuildings.forEach(b => {
            ctx.fillStyle = b.color;
            ctx.fillRect(b.x, b.y, b.width, b.height);
            // --- THIS IS THE RESTORED GRAPHICS CODE ---
            ctx.fillStyle = `rgba(180, 180, 255, ${b.speed * 0.5})`;
            for(let y = b.y; y < canvas.height; y += 15) {
                for(let x = b.x; x < b.x + b.width; x += 10) {
                    if(Math.random() > 0.3) { // Adjusted for more windows
                        ctx.fillRect(x + 2, y + 2, 2, 5);
                    }
                }
            }
        });
    }

    function drawObstacles() {
        ctx.fillStyle = '#f0f';
        obstacles.forEach(o => {
            ctx.fillRect(o.x, 0, o.width, o.top);
            ctx.fillRect(o.x, canvas.height - o.bottom, o.width, o.bottom);
        });
    }

    function drawPowerups() {
        powerups.forEach(p => {
            ctx.fillStyle = p.type === 'shield' ? '#00ffff' : '#ff00ff';
            ctx.beginPath(); ctx.arc(p.x, p.y, p.size / 2, 0, Math.PI * 2); ctx.fill();
        });
    }

    function drawDataBits() {
        ctx.fillStyle = '#ffd700';
        dataBitCoins.forEach(c => ctx.fillRect(c.x, c.y, c.size, c.size));
    }

    function drawParticles() {
        particles.forEach(p => {
            ctx.globalAlpha = p.life / 50;
            ctx.fillStyle = p.color;
            ctx.fillRect(p.x, p.y, p.size, p.size);
        });
        ctx.globalAlpha = 1;
    }

    // =========================================================================
    //                              COLLISIONS & HELPERS
    // =========================================================================
    function checkCollisions() {
        if (drone.y + drone.height > canvas.height || drone.y < 0) return gameOver();

        for (const o of obstacles) {
            if (drone.x < o.x + o.width && drone.x + drone.width > o.x && (drone.y < o.top || drone.y + drone.height > canvas.height - o.bottom)) {
                if (drone.shield) {
                    drone.shield = false;
                    obstacles = obstacles.filter(obs => obs !== o);
                    playSound('crash');
                } else {
                    return gameOver();
                }
            }
            if (!o.passed && drone.x > o.x + o.width) {
                score++;
                o.passed = true;
                hud.score.textContent = `SCORE: ${score}`;
                playSound('score');
            }
        }

        for (let i = powerups.length - 1; i >= 0; i--) {
            const p = powerups[i];
            if (Math.hypot(drone.x - p.x, drone.y - p.y) < 50) {
                if (p.type === 'shield') { drone.shield = true; sessionStats.shieldsUsed++; }
                if (p.type === 'slowmo') drone.slowmo = 60 * 5;
                powerups.splice(i, 1);
                playSound('powerup');
            }
        }

        for (let i = dataBitCoins.length - 1; i >= 0; i--) {
            const c = dataBitCoins[i];
            if (Math.hypot(drone.x - c.x, drone.y - c.y) < 50) {
                playerData.dataBits++;
                sessionStats.bitsCollected++;
                hud.dataBits.textContent = `DATA-BITS: ${playerData.dataBits}`;
                dataBitCoins.splice(i, 1);
                playSound('coin');
            }
        }
    }

    function checkMissions() {
        sessionStats.score = score;
        for (const id in missionDefs) {
            if (!playerData.missions[id] && missionDefs[id].check(sessionStats)) {
                playerData.missions[id] = true;
                playerData.dataBits += missionDefs[id].reward;
            }
        }
    }
    
    function createParticle(x, y, color, speed) {
        particles.push({ x: x, y: y, size: Math.random() * 3 + 1, life: 50, color: color, velocity: { x: Math.random() * 2 + speed, y: (Math.random() - 0.5) * 2 } });
    }

    function createBackground() {
        for (let i = 0; i < 100; i++) backgroundStars.push({ x: Math.random() * canvas.width, y: Math.random() * canvas.height, size: Math.random() * 2 + 1, speed: Math.random() * 0.2 + 0.1 });
        for (let i = 0; i < 30; i++) {
            const far = Math.random() > 0.5;
            backgroundBuildings.push({ x: (canvas.width / 30) * i * 2 + Math.random() * 100, y: canvas.height - (Math.random() * canvas.height * 0.6 + canvas.height * 0.1), width: Math.random() * 50 + 30, height: canvas.height, speed: far ? 0.2 : 0.4, color: far ? `rgba(10, 10, 50, 0.8)` : `rgba(20, 20, 80, 0.7)` });
        }
    }

    // =========================================================================
    //                                  MAIN LOOP
    // =========================================================================
    function mainLoop() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        let gameSpeed = settings ? settings.obstacleSpeed : 4;
        if (gameState === 'playing' && drone.slowmo > 0) {
            gameSpeed *= 0.5;
            drone.slowmo--;
            hud.powerupStatus.textContent = `SLOW-MO: ${Math.ceil(drone.slowmo / 60)}`;
        } else if (gameState === 'playing') {
            hud.powerupStatus.textContent = drone.shield ? 'SHIELD ACTIVE' : '';
        }

        updateBackground(gameSpeed);
        drawBackground();

        if (gameState === 'playing') {
            updateGame(gameSpeed);
            drawGame();
        } else if (gameState === 'gameover') {
            // On game over, just draw the last frame of the game without updating it.
            drawGame();
        }

        requestAnimationFrame(mainLoop);
    }

    // =========================================================================
    //                                  INITIALIZATION
    // =========================================================================
    function handleInput(e) {
        if (gameState === 'playing') {
            drone.velocity = settings.lift;
            playSound('lift');
        }
        if (e.code === 'Space') e.preventDefault();
    }

    function init() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        drone.x = canvas.width / 4;
        createBackground();
        setupUI();
        switchScreen('mainMenu');
        mainLoop(); // Start the one and only loop.
    }

    document.addEventListener('keydown', e => { if (e.code === 'Space') handleInput(e); });
    document.addEventListener('mousedown', handleInput);
    document.addEventListener('touchstart', e => { e.preventDefault(); handleInput(e); });
    window.addEventListener('resize', () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        drone.x = canvas.width / 4;
    });

    init();
});