"use client";

import { DownloadIcon } from "lucide-react";
import { useState } from "react";

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
import { cleanExportName, ExportFormat } from "@/lib/storage/export-name";

const FORMAT_INFO: Record<ExportFormat, string> = {
	csv: "Spreadsheet (opens in Excel): one row per repetition and measure.",
	json: "Full backup of this session, including the angle recordings.",
};

// "Export CSV" / "Export JSON" buttons; each asks for an optional file name first.
export default function ExportButtons({ sessionId, defaultName }: { sessionId: string; defaultName: string }) {
	const [format, setFormat] = useState<ExportFormat | null>(null);
	const [fileName, setFileName] = useState(defaultName);

	const open = (next: ExportFormat) => {
		setFileName(defaultName);
		setFormat(next);
	};

	const download = (event: React.FormEvent) => {
		event.preventDefault();
		if (format === null) return;
		const params = new URLSearchParams({ format });
		const name = cleanExportName(fileName);
		if (name) params.set("name", name);

		// The server replies with a file attachment, so this downloads without leaving the page.
		const link = document.createElement("a");
		link.href = `/api/sessions/${sessionId}/export?${params}`;
		link.click();
		setFormat(null);
	};

	return (
		<>
			<div className="flex gap-2">
				{(["csv", "json"] as const).map((item) => (
					<Button key={item} variant={item === "csv" ? "default" : "outline"} onClick={() => open(item)}>
						<DownloadIcon />
						Export {item.toUpperCase()}
					</Button>
				))}
			</div>

			<Dialog open={format !== null} onOpenChange={(isOpen) => !isOpen && setFormat(null)}>
				<DialogContent className="sm:max-w-md">
					<form className="flex flex-col gap-5" onSubmit={download}>
						<DialogHeader>
							<DialogTitle>Export {format?.toUpperCase()}</DialogTitle>
							<DialogDescription>{format && FORMAT_INFO[format]}</DialogDescription>
						</DialogHeader>

						<div className="flex flex-col gap-2">
							<Label htmlFor="export-file-name">
								File name <span className="text-muted-foreground font-normal">(optional)</span>
							</Label>
							<div className="flex items-center gap-2">
								<Input
									id="export-file-name"
									value={fileName}
									maxLength={100}
									placeholder={defaultName}
									onChange={(event) => setFileName(event.target.value)}
								/>
								<span className="text-muted-foreground text-sm">.{format}</span>
							</div>
							<p className="text-muted-foreground text-xs">Leave empty to use “{defaultName}”.</p>
						</div>

						<DialogFooter>
							<Button type="button" variant="outline" onClick={() => setFormat(null)}>
								Cancel
							</Button>
							<Button type="submit">
								<DownloadIcon />
								Download
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
		</>
	);
}
