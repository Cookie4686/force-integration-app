// The six joints covered by the MRC test, in test order. Shared by the /mrc
// start page and the per-joint test route so both stay in sync.

export type MrcJointId = "shoulder" | "elbow" | "wrist" | "hip" | "knee" | "ankle";

export type MrcJoint = {
	id: MrcJointId;
	name: string;
	region: "Upper limb" | "Lower limb";
	description: string;
	repetitions: number;
};

export const MRC_JOINTS: MrcJoint[] = [
	{ id: "shoulder", name: "Shoulder", region: "Upper limb", description: "Assess the shoulder joint.", repetitions: 5 },
	{ id: "elbow", name: "Elbow", region: "Upper limb", description: "Assess the elbow joint.", repetitions: 5 },
	{ id: "wrist", name: "Wrist", region: "Upper limb", description: "Assess the wrist joint.", repetitions: 5 },
	{ id: "hip", name: "Hip", region: "Lower limb", description: "Assess the hip joint.", repetitions: 5 },
	{ id: "knee", name: "Knee", region: "Lower limb", description: "Assess the knee joint.", repetitions: 5 },
	{ id: "ankle", name: "Ankle", region: "Lower limb", description: "Assess the ankle joint.", repetitions: 5 },
];

export const getMrcJoint = (id: string): MrcJoint | undefined => MRC_JOINTS.find((joint) => joint.id === id);
