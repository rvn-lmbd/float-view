import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { RowKey, type RowWithIndex } from '../../lib/parse/types';
import { BoardPosition3d, type CreateRenderer, type RendererOptions, type SendProgressUpdate } from './types';
import boardGlbUrl from '../../assets/board.glb?url';
import { draw2d, getCtxFont } from './2d';

const IS_WORKER = typeof importScripts === 'function';

function create2dTexture(
  canvasWidth: number,
  canvasHeight: number,
  options: RendererOptions,
): {
  texture: THREE.Texture;
  redraw: (data: RowWithIndex) => void;
} {
  const canvas = new OffscreenCanvas(canvasWidth, canvasHeight);
  const ctx = canvas.getContext('2d')!;
  const texture = new THREE.CanvasTexture(canvas);

  // HTML canvas' origin is top-left, but three.js uses WebGL whose origin is bottom-left.
  texture.flipY = true;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;

  const redraw = (data: RowWithIndex) => {
    draw2d({
      canvas,
      ctx,
      data,
      drawBoard: false,
      drawBackground: false,
      drawRemoteTilt: options.drawRemoteTilt,
      footpadThresholdVolts: options.footpadThresholdVolts,
      backgroundColor: options.backgroundColor,
      images: options.images,
    });
    texture.needsUpdate = true;
  };

  return { texture, redraw };
}

function textureTreads(size: number = 512, lineWidth: number = 4, spacing: number = 28): THREE.Texture {
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#303030';
  ctx.fillRect(0, 0, size, size);

  const h = size / 2;

  // Set up line style
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';

  // Draw horizontal lines for center treads
  const lines = [0.2, 0.4, 0.6, 0.8];
  ctx.beginPath();
  lines.forEach((line) => {
    ctx.moveTo(0, h + h * line);
    ctx.lineTo(size, h + h * line);
  });
  ctx.stroke();

  // Draw diagonal lines going from top-left to bottom-right
  ctx.strokeStyle = '#000000';
  for (let i = -size; i <= size; i += spacing) {
    ctx.beginPath();
    ctx.moveTo(i, h);
    ctx.lineTo(i + size, h + size);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.repeat.set(1, 1);

  return texture;
}

let _boardModel: THREE.Group | null = null;
function loadModels(sendProgressUpdate: SendProgressUpdate) {
  if (_boardModel) {
    return Promise.resolve({ boardModel: _boardModel.clone() });
  }

  sendProgressUpdate(0.1, 'Loading board model');
  console.time('loadBoardModel');
  const loader = new GLTFLoader();
  return new Promise<{ boardModel: THREE.Group }>((resolve, reject) => {
    loader.load(
      boardGlbUrl,
      (gltf) => {
        _boardModel = gltf.scene;

        // Log all the parts of the model to see what's available
        console.debug('Board model parts:');
        _boardModel.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            console.debug('- Mesh name:', child.name);
          }
        });

        _boardModel.traverse((child) => {
          if (!(child instanceof THREE.Mesh)) return;

          if (child.name.includes('Wheel')) {
            child.material = new THREE.MeshPhongMaterial({ map: textureTreads() });
          }

          if (child.name.includes('Footpad')) {
            child.material = new THREE.MeshPhongMaterial({ color: '#78350f' });
          }

          if (child.name.includes('Box')) {
            child.material = new THREE.MeshPhongMaterial({ color: '#555' });
          }

          if (child.name.includes('Rail')) {
            child.material = new THREE.MeshPhongMaterial({ color: '#888' });
          }

          if (!child.name.includes('Wheel')) {
            child.add(
              new THREE.LineSegments(
                new THREE.EdgesGeometry(child.geometry),
                new THREE.LineBasicMaterial({ color: '#000' }),
              ),
            );
          }
        });

        resolve({ boardModel: _boardModel.clone() });
        console.timeEnd('loadBoardModel');
      },
      (progress) => {
        // TODO: send progress to ui thread
        // console.log('Loading progress:', progress);
      },
      (error) => {
        console.error('Error loading board model:', error);
        reject(error);
      },
    );
  });
}

function getCameraVectors(
  boardPosition: RendererOptions['boardPosition3d'],
  boardPosition3dRaised: RendererOptions['boardPosition3dRaised'],
): {
  lookTarget: THREE.Vector3;
  position: THREE.Vector3;
} {
  switch (boardPosition) {
    case BoardPosition3d.Left:
      return boardPosition3dRaised
        ? { lookTarget: new THREE.Vector3(-0.1, -0.1, 2.3), position: new THREE.Vector3(-9.8, 5.4, 1.9) }
        : { lookTarget: new THREE.Vector3(-0.0, 0.2, 2.3), position: new THREE.Vector3(-10.8, 0.6, -0.2) };
    case BoardPosition3d.Right:
      return boardPosition3dRaised
        ? { lookTarget: new THREE.Vector3(-0.0, 0.0, -2.2), position: new THREE.Vector3(9.8, 5.4, -1.8) }
        : { lookTarget: new THREE.Vector3(0.0, 0.2, -2.3), position: new THREE.Vector3(10.9, 0.6, 0.3) };
    case BoardPosition3d.Front:
      return boardPosition3dRaised
        ? { lookTarget: new THREE.Vector3(-2.3, -0.6, 0.1), position: new THREE.Vector3(-1.3, 5.9, -8.7) }
        : { lookTarget: new THREE.Vector3(-2.2, 0.1, -0.4), position: new THREE.Vector3(0.0, 0.6, -9.9) };
    case BoardPosition3d.FrontLeft:
      return boardPosition3dRaised
        ? { lookTarget: new THREE.Vector3(-2.8, 0.7, -0.3), position: new THREE.Vector3(-7.9, 3.5, -6.4) }
        : { lookTarget: new THREE.Vector3(-2.7, 0.2, -0.5), position: new THREE.Vector3(-7.6, 0.6, -6.5) };
    case BoardPosition3d.FrontRight:
      return boardPosition3dRaised
        ? { lookTarget: new THREE.Vector3(-4.5, -2.6, 0.2), position: new THREE.Vector3(6.3, 5.2, -7.4) }
        : { lookTarget: new THREE.Vector3(-5.1, -0.4, 0.2), position: new THREE.Vector3(7.1, 0.6, -6.6) };
    case BoardPosition3d.Back:
      return boardPosition3dRaised
        ? { lookTarget: new THREE.Vector3(2.4, -0.8, -0.3), position: new THREE.Vector3(1.1, 6.0, 8.6) }
        : { lookTarget: new THREE.Vector3(2.2, 0.3, -0.1), position: new THREE.Vector3(-0.1, 0.6, 9.3) };
    case BoardPosition3d.BackLeft:
      return boardPosition3dRaised
        ? { lookTarget: new THREE.Vector3(5, -2, 0.1), position: new THREE.Vector3(-7, 4.5, 7) }
        : { lookTarget: new THREE.Vector3(5.0, -0.4, -0.3), position: new THREE.Vector3(-7.1, 0.6, 6.7) };
    case BoardPosition3d.BackRight:
      return boardPosition3dRaised
        ? { lookTarget: new THREE.Vector3(2.8, 0.8, -0.1), position: new THREE.Vector3(7.8, 4.9, 5.9) }
        : { lookTarget: new THREE.Vector3(2.3, 0.3, 0.4), position: new THREE.Vector3(7.0, 0.5, 7.0) };
  }
}

function createOverlayMesh(width: number, height: number, tex: THREE.Texture): THREE.Mesh {
  // Create a plane geometry that covers the entire screen
  const geometry = new THREE.PlaneGeometry(width, height);
  const material = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthTest: false, // Always render on top
    depthWrite: false, // Don't write to depth buffer
  });
  const mesh = new THREE.Mesh(geometry, material);

  // Position the UI plane
  mesh.position.set(width / 2, height / 2, 0);
  return mesh;
}

const vecToString = (vec: THREE.Vector3) => {
  const pad = (n: number) => n.toFixed(1).padStart(5, ' ');
  return `x=${pad(vec.x)} y=${pad(vec.y)} z=${pad(vec.z)}`;
};

const getLookVector = (camera: THREE.Camera, controls: OrbitControls): THREE.Vector3 => {
  const direction = camera.getWorldDirection(new THREE.Vector3());
  const distance = camera.position.distanceTo(controls.target);
  return camera.position.clone().add(direction.multiplyScalar(distance));
};

export const create3dRenderer: CreateRenderer = async (canvas, options, sendProgressUpdate) => {
  //
  // Setup scene
  //

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(options.backgroundColor);
  const camera = new THREE.PerspectiveCamera(75, canvas.width / canvas.height, 0.1, 1000);
  const renderer = new THREE.WebGLRenderer({ canvas });
  renderer.autoClear = false;

  const cameraVectors = getCameraVectors(options.boardPosition3d, options.boardPosition3dRaised);
  camera.position.copy(cameraVectors.position);
  camera.lookAt(cameraVectors.lookTarget);

  let controls: OrbitControls | null = null;
  if (!IS_WORKER) {
    controls = new OrbitControls(camera, canvas as HTMLCanvasElement);
    controls.target.copy(cameraVectors.lookTarget);
    controls.update();
  }

  scene.add(new THREE.AmbientLight('#fff', 5));
  scene.add(new THREE.HemisphereLight('#b1e1ff', '#b97a20', 1.0));

  const dirLight = new THREE.DirectionalLight('#ffffff', 0.8);
  dirLight.position.set(1, 1, 1);
  scene.add(dirLight);

  //
  // Models
  //

  // Create a container for the board model to handle centering
  const boardContainer = new THREE.Group();
  scene.add(boardContainer);

  // Calculate the bounding box to center the model properly
  const { boardModel } = await loadModels(sendProgressUpdate);
  const boundingBox = new THREE.Box3().setFromObject(boardModel);
  const center = boundingBox.getCenter(new THREE.Vector3());

  // Position the model within the container so its geometric center is at the container's origin
  boardModel.position.set(-center.x, -center.y, -center.z);
  boardContainer.add(boardModel);
  boardContainer.position.set(0, 0.5, 0);

  //
  // Setup orthographic camera for UI overlays
  //

  const uiScene = new THREE.Scene();
  const uiCamera = new THREE.OrthographicCamera(0, canvas.width, canvas.height, 0, -1, 1);

  const { texture: ui2dTexture, redraw: render2d } = create2dTexture(canvas.width, canvas.height, options);
  uiScene.add(createOverlayMesh(canvas.width, canvas.height, ui2dTexture));

  let renderDevInfo: (() => void) | null = null;
  if (!IS_WORKER) {
    const devCanvas = new OffscreenCanvas(canvas.width, canvas.height);
    const ctx = devCanvas.getContext('2d')!;
    const texture = new THREE.CanvasTexture(devCanvas);

    // HTML canvas' origin is top-left, but three.js uses WebGL whose origin is bottom-left.
    texture.flipY = true;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;

    const fontSize = 24;

    // let lastOutput = Date.now();
    renderDevInfo = () => {
      ctx.clearRect(0, 0, devCanvas.width, devCanvas.height);

      ctx.font = getCtxFont(fontSize);
      ctx.fillStyle = '#ff0000';
      ctx.fillText(`Camera Position: ${vecToString(camera.position)}`, fontSize, fontSize);
      ctx.fillText(`Camera Target:   ${vecToString(getLookVector(camera, controls!))}`, fontSize, fontSize * 2);
      texture.needsUpdate = true;

      // if (Date.now() - lastOutput > 1000) {
      //   const posi = camera.position;
      //   const look = getLookVector(camera, controls!);
      //   console.debug(
      //     `{ lookTarget: new THREE.Vector3(${look.x.toFixed(1)}, ${look.y.toFixed(1)}, ${look.z.toFixed(1)}), position: new THREE.Vector3(${posi.x.toFixed(1)}, ${posi.y.toFixed(1)}, ${posi.z.toFixed(1)}) }`,
      //   );

      //   lastOutput = Date.now();
      // }
    };

    uiScene.add(createOverlayMesh(canvas.width, canvas.height, texture));
  }

  //
  // Renderer
  //

  return {
    close: () => {
      renderer.dispose();
      renderer.forceContextLoss();
    },
    draw: async (data) => {
      {
        const pitchRadians = THREE.MathUtils.degToRad(data[RowKey.TruePitch]);
        const rollRadians = THREE.MathUtils.degToRad(data[RowKey.Roll]);

        // Apply pitch and roll rotations using quaternions to avoid gimbal lock
        const rollQuaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), rollRadians);
        const pitchQuaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitchRadians);

        // Combine the rotations: apply pitch first, then roll
        const combinedQuaternion = new THREE.Quaternion().multiplyQuaternions(rollQuaternion, pitchQuaternion);

        boardContainer.quaternion.copy(combinedQuaternion);
      }

      {
        render2d(data);
        renderDevInfo?.();
      }

      // render main scene
      renderer.clear();
      renderer.render(scene, camera);
      // render ui scene on top
      renderer.render(uiScene, uiCamera);

      // HACK: seems like there's a delay between when three.js finishes rendering to the canvas
      // to when the data is available on the canvas, and I'm not sure if it's possible to know
      // exactly when rendering is complete... This seems to fix it at a large performance cost.
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await new Promise((resolve) => requestAnimationFrame(resolve));
    },
  };
};

