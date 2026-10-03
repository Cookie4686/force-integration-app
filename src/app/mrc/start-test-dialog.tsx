"use client";

import { cn } from "cn";
import { CheckIcon, Loader2Icon, PlayIcon, SearchIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import type { Patient } from "@/lib/storage/types";

import { createPatient, listPatients, prepareSession } from "@/app/mrc/actions";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { mrcTestHref } from "@/lib/mrc/routes";

export type StartRequest = {
	testId: string;
	sequence: boolean;
	// Shown in the dialog and used as the default test name, e.g. "Full test" or "Right Shoulder".
	title: string;
};

// Remembers the last chosen patient in this browser (convenience only).
const LAST_PATIENT_KEY = "mrc:lastPatientId";
const readLastPatient = (): string | null => {
	try {
		return localStorage.getItem(LAST_PATIENT_KEY);
	} catch {
		return null;
	}
};
const writeLastPatient = (id: string) => {
	try {
		localStorage.setItem(LAST_PATIENT_KEY, id);
	} catch {
		// storage blocked — not important
	}
};

const formatDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });

// Popup shown before a test starts: test name + existing or new patient.
// Names can be in any language (e.g. Thai) and may repeat.
export default function StartTestDialog({
	request,
	manual,
	onClose,
}: {
	request: StartRequest;
	manual: boolean;
	onClose: () => void;
}) {
	const router = useRouter();
	const [testName, setTestName] = useState(request.title);
	const [tab, setTab] = useState<"existing" | "new">("existing");

	const [patients, setPatients] = useState<Patient[] | null>(null);
	const [search, setSearch] = useState("");
	const [patientId, setPatientId] = useState<string | null>(null);
	const [newName, setNewName] = useState("");
	const [newHn, setNewHn] = useState("");

	const [isSubmitting, setIsSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		listPatients()
			.then((list) => {
				setPatients(list);
				const last = readLastPatient();
				if (last && list.some((patient) => patient.id === last)) setPatientId(last);
				// No patients yet → go straight to "New patient".
				if (list.length === 0) setTab("new");
			})
			.catch(() => setError("Could not load patients. Is the app server running?"));
	}, []);

	const query = search.normalize("NFC").trim().toLowerCase();
	const shownPatients = (patients ?? []).filter(
		(patient) => !query || patient.name.toLowerCase().includes(query) || patient.hn.toLowerCase().includes(query)
	);

	const canStart =
		!isSubmitting && testName.trim() !== "" && (tab === "existing" ? patientId !== null : newName.trim() !== "");

	const start = async (event: React.FormEvent) => {
		event.preventDefault();
		if (!canStart) return;
		setIsSubmitting(true);
		setError(null);
		try {
			let id = patientId;
			if (tab === "new") {
				const patient = await createPatient({ name: newName, hn: newHn });
				// If starting fails below, retrying uses this patient instead of creating it twice.
				setPatients((prev) => [...(prev ?? []), patient].sort((a, b) => a.name.localeCompare(b.name, "th")));
				setPatientId(patient.id);
				setTab("existing");
				id = patient.id;
			}
			if (!id) throw new Error("Choose a patient.");
			writeLastPatient(id);

			// Nothing is saved yet: the session file is created by the first repetition.
			const session = await prepareSession({
				patientId: id,
				name: testName,
				mode: manual ? "manual" : "force",
				sequence: request.sequence,
			});
			router.push(mrcTestHref(request.testId, { sequence: request.sequence, manual, session }));
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not start the test.");
			setIsSubmitting(false);
		}
	};

	return (
		<Dialog open onOpenChange={(open) => !open && !isSubmitting && onClose()}>
			<DialogContent className="sm:max-w-lg">
				<form className="flex flex-col gap-5" onSubmit={start}>
					<DialogHeader>
						<DialogTitle>Start test</DialogTitle>
						<DialogDescription>
							{request.title} · {manual ? "Without force" : "With force device"}
						</DialogDescription>
					</DialogHeader>

					<div className="flex flex-col gap-2">
						<Label htmlFor="start-test-name">Test name</Label>
						<Input
							id="start-test-name"
							value={testName}
							maxLength={100}
							placeholder="e.g. ติดตามผล สัปดาห์ที่ 2"
							onChange={(event) => setTestName(event.target.value)}
						/>
					</div>

					<div className="flex flex-col gap-2">
						<Label>Patient</Label>
						<Tabs value={tab} onValueChange={(value) => setTab(value as "existing" | "new")}>
							<TabsList className="w-full">
								<TabsTrigger value="existing">Existing patient</TabsTrigger>
								<TabsTrigger value="new">New patient</TabsTrigger>
							</TabsList>

							<TabsContent className="flex flex-col gap-2 pt-2" value="existing">
								<div className="relative">
									<SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
									<Input
										className="pl-8"
										placeholder="Search name or HN"
										value={search}
										onChange={(event) => setSearch(event.target.value)}
									/>
								</div>
								<div className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-lg border p-1" role="listbox">
									{patients === null ?
										<p className="text-muted-foreground p-3 text-sm">Loading…</p>
									: shownPatients.length === 0 ?
										<p className="text-muted-foreground p-3 text-sm">
											{patients.length === 0 ? "No patients yet — add one in “New patient”." : "No match."}
										</p>
									:	shownPatients.map((patient) => {
											const selected = patient.id === patientId;
											return (
												<button
													className={cn(
														"flex items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors",
														selected ? "bg-primary text-primary-foreground" : "hover:bg-muted"
													)}
													key={patient.id}
													type="button"
													role="option"
													aria-selected={selected}
													onClick={() => setPatientId(patient.id)}
												>
													<span className="flex flex-col">
														<span className="font-medium">{patient.name}</span>
														{/* HN + date tell apart patients with the same name. */}
														<span
															className={cn(
																"text-xs",
																selected ? "text-primary-foreground/80" : "text-muted-foreground"
															)}
														>
															{patient.hn ? `HN ${patient.hn} · ` : ""}Added {formatDate(patient.createdAt)}
														</span>
													</span>
													{selected && <CheckIcon className="size-4 shrink-0" />}
												</button>
											);
										})
									}
								</div>
							</TabsContent>

							<TabsContent className="flex flex-col gap-3 pt-2" value="new">
								<div className="flex flex-col gap-2">
									<Label htmlFor="start-new-name">Name</Label>
									<Input
										id="start-new-name"
										value={newName}
										maxLength={100}
										placeholder="ชื่อ นามสกุล"
										onChange={(event) => setNewName(event.target.value)}
									/>
								</div>
								<div className="flex flex-col gap-2">
									<Label htmlFor="start-new-hn">
										HN <span className="text-muted-foreground font-normal">(optional)</span>
									</Label>
									<Input
										id="start-new-hn"
										value={newHn}
										maxLength={100}
										onChange={(event) => setNewHn(event.target.value)}
									/>
									<p className="text-muted-foreground text-xs">
										Names can repeat; the HN helps tell patients with the same name apart.
									</p>
								</div>
							</TabsContent>
						</Tabs>
					</div>

					{error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

					<DialogFooter>
						<Button type="button" variant="outline" disabled={isSubmitting} onClick={onClose}>
							Cancel
						</Button>
						<Button type="submit" disabled={!canStart}>
							{isSubmitting ?
								<Loader2Icon className="animate-spin" />
							:	<PlayIcon />}
							Start test
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
