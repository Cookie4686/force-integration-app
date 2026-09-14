"use client";

import { ActivityIcon, HomeIcon, PersonStandingIcon } from "lucide-react";
import * as React from "react";

import { NavItem, NavMenu } from "@/components/nav/sidebar-main";
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarRail } from "@/components/ui/sidebar";

import NavFooter from "./sidebar-footer";
import NavHeader from "./sidebar-header";

// TODO: make this component accept navitem and pass it from layout instead of hard-coding it here

const navItemsDashboard: NavItem[] = [{ title: "Home", url: "/", icon: HomeIcon }];

const navItemsTest: NavItem[] = [{ title: "MRC", url: "/mrc", icon: ActivityIcon }];

const navItemsTool: NavItem[] = [{ title: "Pose", url: "/tool/pose", icon: PersonStandingIcon }];

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
	return (
		<Sidebar collapsible="icon" {...props}>
			<SidebarHeader>
				<NavHeader />
			</SidebarHeader>
			<SidebarContent>
				<NavMenu label="Dashboard" items={navItemsDashboard} />
				<NavMenu label="Test" items={navItemsTest} />
				<NavMenu label="Tools" items={navItemsTool} />
			</SidebarContent>
			<SidebarFooter>
				<NavFooter />
			</SidebarFooter>
			<SidebarRail />
		</Sidebar>
	);
}
