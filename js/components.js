/**
 * Composants A-Frame partagés entre les exercices.
 *
 * - keyboard-movement : déplacement WASD fluide (accélération / décélération),
 *   saut avec détection de sol par raycaster, et option camera-relative.
 * - orbit-camera : caméra orbitale qui suit une cible, orbite à la souris,
 *   zoom à la molette, limites d'angle et lissage.
 * - physics-player : déplacement WASD + saut pilotés par aframe-physics-system,
 *   avec stabilisation de la rotation du corps.
 */

/* ------------------------------------------------------------------------- *
 * Déplacement du cube (Exercices 2, 3 et 4)
 * ------------------------------------------------------------------------- */
AFRAME.registerComponent('keyboard-movement', {
  schema: {
    maxSpeed:       { type: 'number',  default: 6 },
    acceleration:   { type: 'number',  default: 24 },
    deceleration:   { type: 'number',  default: 28 },
    jumpSpeed:      { type: 'number',  default: 7 },
    gravity:        { type: 'number',  default: -22 },
    cameraRelative: { type: 'boolean', default: false },
    ground:         { type: 'selector', default: null }
  },

  init: function () {
    this.velocity = new THREE.Vector3();
    this.currentSpeed = 0;
    this.verticalVelocity = 0;
    this.isGrounded = false;
    this.jumpRequested = false;
    this.halfHeight = 0.5;

    this.keys = { w: false, a: false, s: false, d: false };

    this.raycaster = new THREE.Raycaster();
    this.down = new THREE.Vector3(0, -1, 0);
    this.yAxis = new THREE.Vector3(0, 1, 0);
    this.tmpQuat = new THREE.Quaternion();
    this.tmpEuler = new THREE.Euler();
    this.input = new THREE.Vector3();

    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    this.onLoaded = this.onLoaded.bind(this);

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.el.addEventListener('loaded', this.onLoaded);
  },

  remove: function () {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.el.removeEventListener('loaded', this.onLoaded);
  },

  onLoaded: function () {
    this.updateHalfHeight();
    // Pose le cube exactement sur le plan, quelle que soit sa taille.
    this.el.object3D.position.y = this.halfHeight;
  },

  updateHalfHeight: function () {
    var box = new THREE.Box3().setFromObject(this.el.object3D);
    var size = box.getSize(new THREE.Vector3());
    if (size.y > 0) this.halfHeight = size.y / 2;
  },

  onKeyDown: function (e) {
    var k = e.key.toLowerCase();
    if (this.keys.hasOwnProperty(k)) {
      this.keys[k] = true;
      e.preventDefault();
    }
    if (k === ' ' || e.code === 'Space') {
      this.jumpRequested = true;
      e.preventDefault();
    }
  },

  onKeyUp: function (e) {
    var k = e.key.toLowerCase();
    if (this.keys.hasOwnProperty(k)) this.keys[k] = false;
  },

  getCameraYaw: function () {
    var cam = this.el.sceneEl.camera;
    if (!cam) return 0;
    cam.getWorldQuaternion(this.tmpQuat);
    this.tmpEuler.setFromQuaternion(this.tmpQuat, 'YXZ');
    return this.tmpEuler.y;
  },

  tick: function (time, timeDelta) {
    var dt = Math.min((timeDelta || 0) / 1000, 0.1);
    if (dt <= 0) return;

    var dirX = 0;
    var dirZ = 0;
    if (this.keys.w) dirZ -= 1;
    if (this.keys.s) dirZ += 1;
    if (this.keys.a) dirX -= 1;
    if (this.keys.d) dirX += 1;

    this.input.set(dirX, 0, dirZ);
    var moving = this.input.lengthSq() > 0;
    if (moving) this.input.normalize();

    // Optionnellement, le mouvement est exprimé dans le repère de la caméra.
    if (this.data.cameraRelative) {
      this.input.applyAxisAngle(this.yAxis, this.getCameraYaw());
    }

    // Accélération / décélération progressives.
    if (moving) {
      this.currentSpeed = Math.min(this.data.maxSpeed,
        this.currentSpeed + this.data.acceleration * dt);
    } else {
      this.currentSpeed = Math.max(0,
        this.currentSpeed - this.data.deceleration * dt);
    }

    // Gravité et saut (le saut n'est possible qu'au sol).
    if (!this.isGrounded) {
      this.verticalVelocity += this.data.gravity * dt;
    } else if (this.jumpRequested) {
      this.verticalVelocity = this.data.jumpSpeed;
      this.isGrounded = false;
    }
    this.jumpRequested = false;

    var pos = this.el.object3D.position;
    pos.x += this.input.x * this.currentSpeed * dt;
    pos.z += this.input.z * this.currentSpeed * dt;
    pos.y += this.verticalVelocity * dt;

    this.updateGround();
  },

  updateGround: function () {
    var ground = this.data.ground;
    if (!ground) return;

    var pos = this.el.object3D.position;
    this.raycaster.set(pos, this.down);
    this.raycaster.far = this.halfHeight + 0.15;
    var hits = this.raycaster.intersectObject(ground.object3D, true);
    this.isGrounded = hits.length > 0;

    if (this.isGrounded && this.verticalVelocity <= 0) {
      pos.y = this.halfHeight;
      this.verticalVelocity = 0;
    }
  }
});

/* ------------------------------------------------------------------------- *
 * Caméra orbitale (Exercices 3, 4, 5 et 6)
 * ------------------------------------------------------------------------- */
AFRAME.registerComponent('orbit-camera', {
  schema: {
    target:        { type: 'selector', default: null },
    distance:      { type: 'number',  default: 8 },
    minDistance:   { type: 'number',  default: 2 },
    maxDistance:   { type: 'number',  default: 20 },
    // Angle polaire : 0 = au-dessus de la cible, PI/2 = à l'horizontale.
    // La limite basse évite le gimbal exact ; la limite haute (90°)
    // empêche la caméra de passer sous le plan.
    minPolarAngle: { type: 'number',  default: 0.05 },
    maxPolarAngle: { type: 'number',  default: Math.PI / 2 },
    rotateSpeed:   { type: 'number',  default: 0.006 },
    zoomSpeed:     { type: 'number',  default: 0.12 },
    damping:       { type: 'number',  default: 0.18 }
  },

  init: function () {
    this.theta = 0;
    this.phi = Math.PI / 3;
    this.targetTheta = 0;
    this.targetPhi = Math.PI / 3;
    this.currentDistance = this.data.distance;
    this.targetDistance = this.data.distance;

    this.isDragging = false;
    this.lastX = 0;
    this.lastY = 0;
    this.cam = null;

    this.offset = new THREE.Vector3();
    this.targetPos = new THREE.Vector3();

    this.onMouseDown = this.onMouseDown.bind(this);
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onMouseUp = this.onMouseUp.bind(this);
    this.onWheel = this.onWheel.bind(this);

    var canvas = this.el.sceneEl.canvas;
    if (canvas) {
      canvas.addEventListener('mousedown', this.onMouseDown);
      canvas.addEventListener('wheel', this.onWheel, { passive: false });
    }
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mouseup', this.onMouseUp);
  },

  remove: function () {
    var canvas = this.el.sceneEl.canvas;
    if (canvas) {
      canvas.removeEventListener('mousedown', this.onMouseDown);
      canvas.removeEventListener('wheel', this.onWheel);
    }
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mouseup', this.onMouseUp);
  },

  onMouseDown: function (e) {
    if (e.button !== 0) return;
    e.preventDefault();
    this.isDragging = true;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
  },

  onMouseMove: function (e) {
    if (!this.isDragging) return;
    var dx = e.clientX - this.lastX;
    var dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;

    this.targetTheta -= dx * this.data.rotateSpeed;
    this.targetPhi -= dy * this.data.rotateSpeed;

    var min = this.data.minPolarAngle;
    var max = this.data.maxPolarAngle;
    this.targetPhi = Math.max(min, Math.min(max, this.targetPhi));
  },

  onMouseUp: function () {
    this.isDragging = false;
  },

  onWheel: function (e) {
    e.preventDefault();
    this.targetDistance += e.deltaY * this.data.zoomSpeed;
    this.targetDistance = Math.max(this.data.minDistance,
      Math.min(this.data.maxDistance, this.targetDistance));
  },

  tick: function () {
    var target = this.data.target;
    if (!target) return;

    // Lissage pour des mouvements fluides et sans à-coups.
    var d = this.data.damping;
    this.theta += (this.targetTheta - this.theta) * d;
    this.phi += (this.targetPhi - this.phi) * d;
    this.currentDistance += (this.targetDistance - this.currentDistance) * d;

    var sinPhi = Math.sin(this.phi);
    this.offset.set(
      this.currentDistance * sinPhi * Math.sin(this.theta),
      this.currentDistance * Math.cos(this.phi),
      this.currentDistance * sinPhi * Math.cos(this.theta)
    );

    // Suivi automatique : position de la cible + décalage sphérique.
    this.targetPos.copy(target.object3D.position);
    this.el.object3D.position.copy(this.targetPos).add(this.offset);

    // Oriente la caméra active vers la cible.
    if (!this.cam) this.cam = this.el.sceneEl.camera;
    if (this.cam) this.cam.lookAt(this.targetPos);
  }
});

/* ------------------------------------------------------------------------- *
 * Joueur piloté par la physique (Exercices 5 et 6)
 * ------------------------------------------------------------------------- */
AFRAME.registerComponent('physics-player', {
  schema: {
    speed:          { type: 'number',  default: 5 },
    acceleration:   { type: 'number',  default: 12 },
    jumpSpeed:      { type: 'number',  default: 6 },
    cameraRelative: { type: 'boolean', default: true }
  },

  init: function () {
    this.body = null;
    this.grounded = false;
    this.jumpRequested = false;
    this.halfHeight = 0.5;

    this.keys = { w: false, a: false, s: false, d: false };

    this.raycaster = new THREE.Raycaster();
    this.down = new THREE.Vector3(0, -1, 0);
    this.yAxis = new THREE.Vector3(0, 1, 0);
    this.tmpQuat = new THREE.Quaternion();
    this.tmpEuler = new THREE.Euler();
    this.input = new THREE.Vector3();

    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    this.onBodyLoaded = this.onBodyLoaded.bind(this);
    this.onLoaded = this.onLoaded.bind(this);

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);

    if (this.el.body) {
      this.onBodyLoaded({ detail: { body: this.el.body } });
    } else {
      this.el.addEventListener('body-loaded', this.onBodyLoaded);
    }

    this.el.addEventListener('loaded', this.onLoaded);
  },

  remove: function () {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.el.removeEventListener('body-loaded', this.onBodyLoaded);
    this.el.removeEventListener('loaded', this.onLoaded);
  },

  onLoaded: function () {
    var box = new THREE.Box3().setFromObject(this.el.object3D);
    var size = box.getSize(new THREE.Vector3());
    if (size.y > 0) this.halfHeight = size.y / 2;
  },

  onBodyLoaded: function (e) {
    this.body = e.detail.body;
    // Réduit l'impact des collisions sur la rotation : le corps reste stable.
    this.body.fixedRotation = true;
    this.body.angularFactor.set(0, 0, 0);
    this.body.updateMassProperties();
    // Empêche cannon-es d'endormir le corps au repos : sinon la vélocité
    // imposée est ignorée tant que le cube est posé sur le sol.
    this.body.allowSleep = false;
  },

  onKeyDown: function (e) {
    var k = e.key.toLowerCase();
    if (this.keys.hasOwnProperty(k)) {
      this.keys[k] = true;
      e.preventDefault();
    }
    if (k === ' ' || e.code === 'Space') {
      this.jumpRequested = true;
      e.preventDefault();
    }
  },

  onKeyUp: function (e) {
    var k = e.key.toLowerCase();
    if (this.keys.hasOwnProperty(k)) this.keys[k] = false;
  },

  getCameraYaw: function () {
    var cam = this.el.sceneEl.camera;
    if (!cam) return 0;
    cam.getWorldQuaternion(this.tmpQuat);
    this.tmpEuler.setFromQuaternion(this.tmpQuat, 'YXZ');
    return this.tmpEuler.y;
  },

  tick: function (time, timeDelta) {
    var dt = Math.min((timeDelta || 0) / 1000, 0.1);
    if (!this.body || dt <= 0) return;

    var dirX = 0;
    var dirZ = 0;
    if (this.keys.w) dirZ -= 1;
    if (this.keys.s) dirZ += 1;
    if (this.keys.a) dirX -= 1;
    if (this.keys.d) dirX += 1;

    this.input.set(dirX, 0, dirZ);
    var moving = this.input.lengthSq() > 0;
    if (moving) this.input.normalize();

    if (this.data.cameraRelative) {
      this.input.applyAxisAngle(this.yAxis, this.getCameraYaw());
    }

    this.updateGrounded();

    // Accélération exponentielle pour un mouvement fluide, indépendant du FPS.
    var factor = 1 - Math.exp(-this.data.acceleration * dt);
    var targetVx = this.input.x * this.data.speed;
    var targetVz = this.input.z * this.data.speed;

    this.body.velocity.x += (targetVx - this.body.velocity.x) * factor;
    this.body.velocity.z += (targetVz - this.body.velocity.z) * factor;

    // Réveille explicitement le corps lorsqu'une touche est enfoncée.
    if (moving) this.body.wakeUp();

    if (this.jumpRequested && this.grounded) {
      this.body.velocity.y = this.data.jumpSpeed;
      this.grounded = false;
    }
    this.jumpRequested = false;
  },

  updateGrounded: function () {
    var pos = this.el.object3D.position;
    this.raycaster.set(pos, this.down);
    this.raycaster.far = this.halfHeight + 0.2;

    var scene = this.el.sceneEl.object3D;
    var hits = this.raycaster.intersectObject(scene, true);

    var grounded = false;
    for (var i = 0; i < hits.length; i++) {
      var obj = hits[i].object;
      var cur = obj;
      var isSelf = false;
      while (cur) {
        if (cur === this.el.object3D) {
          isSelf = true;
          break;
        }
        cur = cur.parent;
      }
      if (!isSelf) {
        grounded = true;
        break;
      }
    }
    this.grounded = grounded;
  }
});
