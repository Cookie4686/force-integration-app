"use client";

import { cn } from "cn";
import { ActivityIcon, ChevronDownIcon, HomeIcon, PersonStandingIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, useContext, useEffect, useMemo, useState } from "react";

import { AppSidebar, NavItems } from "@/components/nav/sidebar";
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import BreadcrumbProvider, { BreadcrumbContext, HeaderBreadcrumbItem } from "@/context/breadcrumb-context";
import { getClientSideCookie } from "@/lib/utils/cookie";

const navItems: NavItems = [
	{
		groupLabel: "Dashboard",
		items: [{ title: "Home", url: "/", icon: HomeIcon }],
	},
	{
		groupLabel: "Test",
		items: [{ title: "MRC", url: "/mrc", icon: ActivityIcon }],
	},
	{
		groupLabel: "Tools",
		items: [{ title: "Pose", url: "/tool/pose", icon: PersonStandingIcon }],
	},
];

export default function RootLayoutClient({ children }: LayoutProps<"/">) {
	// cookie name is in components/ui/sidebar
	const [sidebarOpen, setSidebarOpen] = useState<boolean | undefined>(undefined);

	useEffect(() => {
		// TODO: I am quite sure that this is safe but maybe there is a better way??
		// eslint-disable-next-line react-hooks/set-state-in-effect
		setSidebarOpen(getClientSideCookie("sidebar_state") === "true");
	}, []);

	const sidebarVariant: React.ComponentProps<typeof AppSidebar>["variant"] = "inset";

	return (
		<SidebarProvider
			open={sidebarOpen}
			onOpenChange={(value) => {
				setSidebarOpen(value);
			}}
		>
			<AppSidebar navItems={navItems} variant={sidebarVariant} />
			<SidebarInset>
				<div className={sidebarVariant === "inset" ? "h-[calc(100svh-16px)]" : "h-svh"}>
					<BreadcrumbProvider>
						{/* TODO: any better way to make header sticky? */}
						<HeaderBreadcrumb className="h-16" />
						<div
							className={cn(
								"overflow-y-scroll",
								sidebarVariant === "inset" ? "h-[calc(100svh-80px)]" : "h-[calc(100svh-64px)]"
							)}
						>
							{children}
						</div>
					</BreadcrumbProvider>
				</div>
			</SidebarInset>
		</SidebarProvider>
	);
}

// TODO: refactor because what is this??

const HOME_BREADCRUMB: HeaderBreadcrumbItem = { title: "home", href: "/" };

function HeaderBreadcrumb({ className }: { className?: string }) {
	const pathname = usePathname();

	const breadcrumbContextValue = useContext(BreadcrumbContext);

	const breadcrumbItems = useMemo<HeaderBreadcrumbItem[]>(() => {
		if (breadcrumbContextValue !== null && breadcrumbContextValue.breadcrumbItem !== null)
			return breadcrumbContextValue.breadcrumbItem;

		const groupItem = navItems.find(({ items }) => items.find(({ url }) => url === pathname));

		if (pathname !== "/" && groupItem)
			return [
				HOME_BREADCRUMB,
				{
					title: groupItem.groupLabel,
					href: pathname,
					subItems: groupItem.items.map(({ title, url }) => ({ title, href: url })),
				},
			];

		const items = pathname
			.split("/")
			.map<HeaderBreadcrumbItem>((path, idx, arr) => {
				return { title: path, href: arr.slice(0, idx + 1).join("/") };
			})
			.filter(({ title }) => title !== "");

		return [{ title: "home", href: "/" }, ...items];
	}, [pathname, breadcrumbContextValue]);

	return (
		<header
			className={cn(
				"flex h-full shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12",
				className
			)}
		>
			<div className="flex items-center gap-2 px-4">
				<SidebarTrigger className="-ml-1" />
				<Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
				<Breadcrumb>
					<BreadcrumbList>
						{breadcrumbItems.map((item, idx, arr) => (
							<Fragment key={idx}>
								{item.subItems ?
									idx !== arr.length - 1 ?
										<BreadcrumbItem className="hidden md:block">
											<BreadcrumbDropdown item={item} />
										</BreadcrumbItem>
									:	<BreadcrumbPage>
											<BreadcrumbDropdown item={item} />
										</BreadcrumbPage>

								:	<BreadcrumbItem className="hidden md:block">
										{idx !== arr.length - 1 ?
											<BreadcrumbLink
												className="capitalize"
												render={<Link href={item.href}>{item.title}</Link>}
											></BreadcrumbLink>
										:	<BreadcrumbPage className="capitalize">{item.title}</BreadcrumbPage>}
									</BreadcrumbItem>
								}
								{idx !== arr.length - 1 && <BreadcrumbSeparator className="hidden md:block" />}
							</Fragment>
						))}
					</BreadcrumbList>
				</Breadcrumb>
			</div>
		</header>
	);
}

function BreadcrumbDropdown({ item }: { item: HeaderBreadcrumbItem }) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<DropdownMenuTrigger
						render={
							<button className="flex items-center gap-1">
								{item.title}
								<ChevronDownIcon data-icon="inline-end" className="size-3.5" />
							</button>
						}
					/>
				}
			/>
			<DropdownMenuContent align="start">
				<DropdownMenuGroup>
					{item.subItems?.map(({ title, href }) => (
						<DropdownMenuItem key={title}>
							<Link href={href}> {title} </Link>
						</DropdownMenuItem>
					))}
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
