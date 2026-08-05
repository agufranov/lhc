/**
 * WebGPU backend — not implemented yet, on purpose.
 *
 * Everything it needs already exists: BeamState is SoA, the lattice is a flat f32
 * table, and FIELD_WGSL is the shader-side twin of the CPU field sampler. What is
 * left to write is the plumbing sketched in PUSH_WGSL below plus ping-pong buffers.
 *
 * The one real trap, written down here so it is not rediscovered the hard way:
 * positions run up to ~1e4 m and we care about millimetres, which is 1e-7 relative —
 * right at the edge of f32. The CPU backend integrates in f64. The GPU version must
 * either keep positions relative to the current sector centre, or split them into
 * hi/lo pairs. Do not just cast the f64 arrays to f32 and call it a day.
 */

import { FIELD_WGSL } from '../field';
import type { BackendFactory } from '../backend';

export const PUSH_WGSL = /* wgsl */ `
struct Params {
  dt: f32,
  chargeOverGammaMass: f32,
  fieldStrength: f32,
  halfWidth: f32,
  sectorCount: u32,
  particleCount: u32,
};

@group(0) @binding(0) var<storage, read_write> pos: array<vec2<f32>>;
@group(0) @binding(1) var<storage, read_write> vel: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read>       sectors: array<f32>;
@group(0) @binding(3) var<uniform>             params: Params;

${FIELD_WGSL}

@compute @workgroup_size(64)
fn push(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= params.particleCount) { return; }

  let p = pos[i];
  let v = vel[i];
  let bz = integrateFieldZ(p, v * params.dt, params.sectorCount, params.halfWidth, params.fieldStrength);
  let ang = -params.chargeOverGammaMass * bz * params.dt;

  let c = cos(ang);
  let s = sin(ang);
  let nv = vec2<f32>(v.x * c - v.y * s, v.x * s + v.y * c);

  vel[i] = nv;
  pos[i] = p + 0.5 * (v + nv) * params.dt;
}
`;

export const webgpuBackendFactory: BackendFactory = {
  id: 'webgpu',
  label: 'GPU (WebGPU)',
  kind: 'gpu',
  async unavailableReason() {
    if (!('gpu' in navigator)) return 'WebGPU is not available in this browser';
    const adapter = await (navigator as Navigator & { gpu: GPUAdapterProvider }).gpu.requestAdapter();
    if (!adapter) return 'no WebGPU adapter';
    return 'backend not implemented yet';
  },
  async create() {
    throw new Error('WebGPU backend is not implemented yet');
  },
};

interface GPUAdapterProvider {
  requestAdapter(): Promise<unknown | null>;
}
