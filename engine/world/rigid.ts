// Rigid-body physics (rotation, stacking, contacts, joints). Public surface of rigid-*.ts; see .agents/skills/physics.
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
export { RigidDistanceJoint, RigidJoint, RigidMouseJoint, RigidRevoluteJoint, RigidWeldJoint } from './rigid-joint';
export type {
  RigidDistanceJointOptions,
  RigidJointCommonOptions,
  RigidJointOptions,
  RigidJointType,
  RigidMouseJointOptions,
  RigidRevoluteJointOptions,
  RigidWeldJointOptions,
} from './rigid-joint';
export { createRigidChain, createRigidRagdoll } from './rigid-presets';
export type {
  RigidChain,
  RigidChainEnd,
  RigidChainOptions,
  RigidRagdoll,
  RigidRagdollJointName,
  RigidRagdollOptions,
  RigidRagdollPart,
  RigidRagdollPose,
} from './rigid-presets';
export { bindRigidNode, drawRigidWorld, RigidDebugView } from './rigid-draw';
export type { RigidBindOptions, RigidDrawColors, RigidDrawOptions } from './rigid-draw';
