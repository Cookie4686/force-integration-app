"use client";

import { createContext, useContext } from "react";

import useHhd from "@/hooks/use-hhd";

export type HhdContextValue = ReturnType<typeof useHhd>;

const HhdContext = createContext<HhdContextValue | null>(null);

// One force-device connection shared by every page below it (the MRC pages), so
// a full test keeps the device connected while it moves from test to test.
// The device is released when the user leaves those pages.
export default function HhdProvider({ children }: { children: React.ReactNode }) {
	const hhd = useHhd();
	return <HhdContext value={hhd}>{children}</HhdContext>;
}

export const useHhdContext = (): HhdContextValue => {
	const value = useContext(HhdContext);
	if (value === null) throw new Error("useHhdContext must be used inside <HhdProvider>.");
	return value;
};
