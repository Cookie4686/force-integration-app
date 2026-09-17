"use client";

import { ActivityIcon, ChevronRight, type LucideIcon, PersonStandingIcon } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

interface Module {
	title: string;
	description: string;
	path: string;
	icon: LucideIcon;
}

const MODULES: Module[] = [
	{
		title: "6 Exercise Test",
		description: "Test shoulder, elbow, wrist, hip, knee, and ankle.",
		path: "/mrc",
		icon: ActivityIcon,
	},
	{
		title: "Pose Detection Tool",
		description: "Tools for testing pose detection model.",
		path: "/tool/pose",
		icon: PersonStandingIcon,
	},
];

export default function HomePage() {
	const router = useRouter();

	return (
		<div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-8 py-12">
			{/* Header */}
			<div className="text-center">
				<h2 className="mb-2 text-3xl font-bold">Select Exercise Module</h2>
				<p className="text-muted-foreground text-sm">Choose a rehabilitation programme to begin</p>
			</div>

			{/* 3-column card grid */}
			<div className="grid grid-cols-3 gap-6 max-md:grid-cols-1">
				{MODULES.map((mod) => (
					<Card className="py-8" key={mod.path}>
						<CardHeader className="space-y-2">
							<div className="flex h-14 w-14 items-center justify-center rounded-md border">
								<mod.icon size={28} />
							</div>
							<CardTitle className="text-lg">{mod.title}</CardTitle>
						</CardHeader>
						<CardContent className="h-full space-y-2">
							<p className="text-muted-foreground flex-1 text-sm">{mod.description}</p>
						</CardContent>
						<CardFooter>
							<Button size="lg" onClick={() => router.push(mod.path)}>
								<span>Open module</span>
								<ChevronRight size={16} />
							</Button>
						</CardFooter>
					</Card>
				))}
			</div>
		</div>
	);
}
