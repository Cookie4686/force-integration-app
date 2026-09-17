"use client";

import * as React from "react";

import { NavItem, NavMenu } from "@/components/nav/sidebar-main";
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarRail } from "@/components/ui/sidebar";

import NavFooter from "./sidebar-footer";
import NavHeader from "./sidebar-header";

export type NavItems = {
	groupLabel: string;
	items: NavItem[];
}[];

export function AppSidebar({ navItems, ...props }: { navItems: NavItems } & React.ComponentProps<typeof Sidebar>) {
	return (
		<Sidebar collapsible="icon" {...props}>
			<SidebarHeader>
				<NavHeader />
			</SidebarHeader>
			<SidebarContent>
				{navItems.map(({ groupLabel, items }) => (
					<NavMenu label={groupLabel} items={items} key={groupLabel} />
				))}
			</SidebarContent>
			<SidebarFooter>
				<NavFooter />
			</SidebarFooter>
			<SidebarRail />
		</Sidebar>
	);
}
