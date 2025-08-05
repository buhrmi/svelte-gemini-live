<script lang="ts">
  import {onMount, onDestroy} from 'svelte';
  import {Analyser} from './analyser';

  import * as THREE from 'three';
  import {EXRLoader} from 'three/addons/loaders/EXRLoader.js';
  import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
  import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
  import {ShaderPass} from 'three/addons/postprocessing/ShaderPass.js';
  import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
  import {FXAAShader} from 'three/addons/shaders/FXAAShader.js';
  import {fs as backdropFS, vs as backdropVS} from './backdrop-shader';
  import {vs as sphereVS} from './sphere-shader';

  export let inputNode: AudioNode;
  export let outputNode: AudioNode;

  let inputAnalyser: Analyser;
  $: if (inputNode) inputAnalyser = new Analyser(inputNode);

  let outputAnalyser: Analyser;
  $: if (outputNode) outputAnalyser = new Analyser(outputNode);

  let canvas: HTMLCanvasElement;
  let camera: THREE.PerspectiveCamera;
  let backdrop: THREE.Mesh;
  let composer: EffectComposer;
  let sphere: THREE.Mesh;
  let prevTime = 0;
  const rotation = new THREE.Vector3(0, 0, 0);
  let animationFrameId: number;

  const init = () => {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x100c14);

    backdrop = new THREE.Mesh(
      new THREE.IcosahedronGeometry(10, 5),
      new THREE.RawShaderMaterial({
        uniforms: {
          resolution: {value: new THREE.Vector2(1, 1)},
          rand: {value: 0},
        },
        vertexShader: backdropVS,
        fragmentShader: backdropFS,
        glslVersion: THREE.GLSL3,
      }),
    );
    backdrop.material.side = THREE.BackSide;
    scene.add(backdrop);

    camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000,
    );
    camera.position.set(2, -2, 5);

    const renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      antialias: !true,
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio / 1);

    const geometry = new THREE.IcosahedronGeometry(1, 10);

    new EXRLoader().load('piz_compressed.exr', (texture: THREE.Texture) => {
      texture.mapping = THREE.EquirectangularReflectionMapping;
      const exrCubeRenderTarget = pmremGenerator.fromEquirectangular(texture);
      (sphere.material as THREE.MeshStandardMaterial).envMap =
        exrCubeRenderTarget.texture;
      sphere.visible = true;
    });

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();

    const sphereMaterial = new THREE.MeshStandardMaterial({
      color: 0x000010,
      metalness: 0.5,
      roughness: 0.1,
      emissive: 0x000010,
      emissiveIntensity: 1.5,
    });

    sphereMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.time = {value: 0};
      shader.uniforms.inputData = {value: new THREE.Vector4()};
      shader.uniforms.outputData = {value: new THREE.Vector4()};

      sphereMaterial.userData.shader = shader;

      shader.vertexShader = sphereVS;
    };

    sphere = new THREE.Mesh(geometry, sphereMaterial);
    scene.add(sphere);
    sphere.visible = false;

    const renderPass = new RenderPass(scene, camera);

    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      5,
      0.5,
      0,
    );

    const fxaaPass = new ShaderPass(FXAAShader);

    composer = new EffectComposer(renderer);
    composer.addPass(renderPass);
    // composer.addPass(fxaaPass);
    composer.addPass(bloomPass);

    function onWindowResize() {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      const dPR = renderer.getPixelRatio();
      const w = window.innerWidth;
      const h = window.innerHeight;
      (backdrop.material as THREE.RawShaderMaterial).uniforms.resolution.value.set(
        w * dPR,
        h * dPR,
      );
      renderer.setSize(w, h);
      composer.setSize(w, h);
      fxaaPass.material.uniforms['resolution'].value.set(
        1 / (w * dPR),
        1 / (h * dPR),
      );
    }

    window.addEventListener('resize', onWindowResize);
    onWindowResize();

    animation();

    return {
      destroy: () => {
        window.removeEventListener('resize', onWindowResize);
        cancelAnimationFrame(animationFrameId);
      },
    };
  };

  const animation = () => {
    animationFrameId = requestAnimationFrame(animation);

    if (!inputAnalyser || !outputAnalyser) return;

    inputAnalyser.update();
    outputAnalyser.update();

    const t = performance.now();
    const dt = (t - prevTime) / (1000 / 60);
    prevTime = t;
    const backdropMaterial = backdrop.material as THREE.RawShaderMaterial;
    const sphereMaterial = sphere.material as THREE.MeshStandardMaterial;

    backdropMaterial.uniforms.rand.value = Math.random() * 10000;

    if (sphereMaterial.userData.shader) {
      sphere.scale.setScalar(1 + (0.2 * outputAnalyser.data[1]) / 255);

      const f = 0.001;
      rotation.x += (dt * f * 0.5 * outputAnalyser.data[1]) / 255;
      rotation.z += (dt * f * 0.5 * inputAnalyser.data[1]) / 255;
      rotation.y += (dt * f * 0.25 * inputAnalyser.data[2]) / 255;
      rotation.y += (dt * f * 0.25 * outputAnalyser.data[2]) / 255;

      const euler = new THREE.Euler(rotation.x, rotation.y, rotation.z);
      const quaternion = new THREE.Quaternion().setFromEuler(euler);
      const vector = new THREE.Vector3(0, 0, 5);
      vector.applyQuaternion(quaternion);
      camera.position.copy(vector);
      camera.lookAt(sphere.position);

      sphereMaterial.userData.shader.uniforms.time.value +=
        (dt * 0.1 * outputAnalyser.data[0]) / 255;
      sphereMaterial.userData.shader.uniforms.inputData.value.set(
        (1 * inputAnalyser.data[0]) / 255,
        (0.1 * inputAnalyser.data[1]) / 255,
        (10 * inputAnalyser.data[2]) / 255,
        0,
      );
      sphereMaterial.userData.shader.uniforms.outputData.value.set(
        (2 * outputAnalyser.data[0]) / 255,
        (0.1 * outputAnalyser.data[1]) / 255,
        (10 * outputAnalyser.data[2]) / 255,
        0,
      );
    }

    composer.render();
  };

  let cleanup: () => void;
  onMount(() => {
    const {destroy} = init();
    cleanup = destroy;
  });

  onDestroy(() => {
    if (cleanup) {
      cleanup();
    }
  });
</script>

<canvas bind:this={canvas}></canvas>

<style>
  canvas {
    width: 100% !important;
    height: 100% !important;
    position: absolute;
    inset: 0;
    image-rendering: pixelated;
  }
</style>
