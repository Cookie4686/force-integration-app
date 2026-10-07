import { FileTextIcon, HistoryIcon, ListChecksIcon, type LucideIcon, PlayIcon, UsersIcon } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";

import type { Session } from "@/lib/storage/types";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getMrcTest, MRC_SIDE_LABEL } from "@/lib/mrc/joints";
import { mrcContinueHref, mrcSessionHref } from "@/lib/mrc/routes";
import { listSessions, readPatients } from "@/lib/storage/files";

const formatDateTime = (iso: string) =>
	new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

// "Right Shoulder", "Right Shoulder, Left Shoulder" or "12 tests".
const describeTests = (session: Session): string => {
	const names = session.tests.map((test) => {
		const config = getMrcTest(test.testId);
		return config ? `${MRC_SIDE_LABEL[config.side]} ${config.joint.name}` : test.testId;
	});
	return names.length <= 2 ? names.join(", ") : `${names.length} tests`;
};

const countReps = (session: Session) => session.tests.reduce((sum, test) => sum + test.reps.length, 0);

// All saved test sessions (data/sessions), newest first.
export default async function PageHistory() {
	// Always read the files fresh — new results can be saved at any time.
	await connection();

	const [sessions, patients] = await Promise.all([listSessions(), readPatients()]);
	const patientById = new Map(patients.map((patient) => [patient.id, patient]));
	const sorted = [...sessions].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
	const totalReps = sessions.reduce((sum, session) => sum + countReps(session), 0);

	return (
		<div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-6 px-8 py-10">
			<div className="flex flex-col gap-1">
				<h2 className="flex items-center gap-2 text-3xl font-bold">
					<HistoryIcon className="size-7" />
					History
				</h2>
				<p className="text-muted-foreground text-sm">All saved test records on this computer, newest first.</p>
			</div>

			<div className="grid grid-cols-3 gap-4 max-md:grid-cols-1">
				<StatCard icon={FileTextIcon} label="Total records" value={sessions.length} />
				<StatCard icon={UsersIcon} label="Total patients" value={patients.length} />
				<StatCard icon={ListChecksIcon} label="Total repetitions" value={totalReps} />
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Records</CardTitle>
				</CardHeader>
				<CardContent>
					{sorted.length === 0 ?
						<div className="flex flex-col items-start gap-3 py-6">
							<p className="text-muted-foreground text-sm">No records yet. Results appear here after a test is run.</p>
							<Link className={buttonVariants({ variant: "outline" })} href="/mrc">
								Go to MRC test
							</Link>
						</div>
					:	<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Date</TableHead>
									<TableHead>Test name</TableHead>
									<TableHead>Patient</TableHead>
									<TableHead>Tests</TableHead>
									<TableHead className="text-right">Reps</TableHead>
									<TableHead>Mode</TableHead>
									<TableHead>Status</TableHead>
									<TableHead className="text-right">
										<span className="sr-only">Actions</span>
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{sorted.map((session) => {
									const patient = patientById.get(session.patientId);
									// Unfinished when a test is left to do (a full test needs all of them).
									const continueHref = session.mode === "manual" ? mrcContinueHref(session) : null;
									const isComplete = mrcContinueHref(session) === null;
									return (
										<TableRow key={session.id}>
											<TableCell className="whitespace-nowrap tabular-nums">
												{formatDateTime(session.startedAt)}
											</TableCell>
											<TableCell className="font-medium">{session.name || "Untitled test"}</TableCell>
											<TableCell>
												<div className="flex flex-col">
													<span>{patient?.name ?? "Unknown patient"}</span>
													{patient?.hn && <span className="text-muted-foreground text-xs">HN {patient.hn}</span>}
												</div>
											</TableCell>
											<TableCell>{describeTests(session)}</TableCell>
											<TableCell className="text-right tabular-nums">{countReps(session)}</TableCell>
											<TableCell className="whitespace-nowrap">
												{session.mode === "manual" ? "Without force" : "With force"}
												{session.source === "video" && " · Video"}
											</TableCell>
											<TableCell>
												<Badge className={isComplete ? "bg-green-600 text-white" : "bg-amber-500 text-white"}>
													{isComplete ? "Completed" : "Incomplete"}
												</Badge>
											</TableCell>
											<TableCell>
												<div className="flex justify-end gap-2">
													{continueHref && (
														<Link className={buttonVariants({ size: "sm" })} href={continueHref}>
															<PlayIcon />
															Continue
														</Link>
													)}
													<Link
														className={buttonVariants({ size: "sm", variant: "outline" })}
														href={mrcSessionHref(session.id)}
													>
														View details
													</Link>
												</div>
											</TableCell>
										</TableRow>
									);
								})}
							</TableBody>
						</Table>
					}
				</CardContent>
			</Card>
		</div>
	);
}

function StatCard({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: number }) {
	return (
		<Card>
			<CardContent className="flex items-center gap-4">
				<div className="flex size-12 shrink-0 items-center justify-center rounded-md border">
					<Icon size={24} />
				</div>
				<div className="flex flex-col">
					<span className="text-muted-foreground text-sm">{label}</span>
					<span className="text-3xl font-bold tabular-nums">{value}</span>
				</div>
			</CardContent>
		</Card>
	);
}
