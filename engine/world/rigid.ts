// Rigid-body physics (rotation, stacking, contacts). Public surface of rigid-*.ts; see .agents/skills/physics.
export { rigidBox, rigidCircle, rigidPolygon, rigidShapeMass } from './rigid-shapes';
export type { RigidCircleShape, RigidPolygonShape, RigidShape } from './rigid-shapes';
export { RigidBody } from './rigid-body';
export type { RigidBodyOptions, RigidBodyType } from './rigid-body';
export { RigidContact, RigidContactPoint, RigidWorld } from './rigid-world';
export type {
  RigidContactEvent,
  RigidQueryOptions,
  RigidRayHit,
  RigidWorldEvents,
  RigidWorldOptions,
} from './rigid-world';
export { bindRigidNode, drawRigidWorld, RigidDebugView } from './rigid-draw';
export type { RigidBindOptions, RigidDrawColors, RigidDrawOptions } from './rigid-draw';
