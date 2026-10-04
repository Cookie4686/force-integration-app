import HhdProvider from "@/context/hhd-context";

// Keeps the force device connected across all MRC pages (e.g. from test to test in a full test).
export default function LayoutMRC({ children }: LayoutProps<"/mrc">) {
	return <HhdProvider>{children}</HhdProvider>;
}
