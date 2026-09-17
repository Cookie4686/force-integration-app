"use client";

import { createContext, useState } from "react";

export type HeaderBreadcrumbItem = {
	title: string;
	href: string;
	subItems?: {
		title: string;
		href: string;
	}[];
};

export type BreadcrumbContextValue = {
	breadcrumbItem: HeaderBreadcrumbItem[] | null;
	setBreadcrumbItem: React.Dispatch<React.SetStateAction<HeaderBreadcrumbItem[] | null>>;
};

export const BreadcrumbContext = createContext<BreadcrumbContextValue | null>(null);

export default function BreadcrumbProvider({ children }: { children: React.ReactNode }) {
	const [breadcrumbItem, setBreadcrumbItem] = useState<HeaderBreadcrumbItem[] | null>(null);

	return <BreadcrumbContext value={{ breadcrumbItem, setBreadcrumbItem }}>{children}</BreadcrumbContext>;
}
