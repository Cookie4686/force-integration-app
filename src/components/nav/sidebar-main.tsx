"use client";

import { ChevronRight, type LucideIcon } from "lucide-react";
import Link from "next/link";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
	SidebarGroup,
	SidebarGroupLabel,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarMenuSub,
	SidebarMenuSubButton,
	SidebarMenuSubItem,
} from "@/components/ui/sidebar";

export type NavItemCollapsible = {
	title: string;
	url: string;
	icon?: LucideIcon;
	isActive?: boolean;
	items?: NavItem[];
};

export type NavItem = {
	title: string;
	url: string;
	icon: LucideIcon;
};

export function NavMenuCollapsible({ label, items }: { label: string; items: NavItemCollapsible[] }) {
	return (
		<SidebarGroup>
			<SidebarGroupLabel>{label}</SidebarGroupLabel>
			<SidebarMenu>
				{items.map((item) => (
					<Collapsible
						key={item.title}
						defaultOpen={item.isActive}
						className="group/collapsible"
						render={
							<SidebarMenuItem>
								<CollapsibleTrigger
									render={
										<SidebarMenuButton tooltip={item.title}>
											{item.icon && <item.icon />}
											<span>{item.title}</span>
											<ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
										</SidebarMenuButton>
									}
								></CollapsibleTrigger>
								<CollapsibleContent>
									<SidebarMenuSub>
										{item.items?.map((subItem) => (
											<SidebarMenuSubItem key={subItem.title}>
												<SidebarMenuSubButton
													render={<Link href={subItem.url}>{subItem.title}</Link>}
												></SidebarMenuSubButton>
											</SidebarMenuSubItem>
										))}
									</SidebarMenuSub>
								</CollapsibleContent>
							</SidebarMenuItem>
						}
					></Collapsible>
				))}
			</SidebarMenu>
		</SidebarGroup>
	);
}

export function NavMenu({ label, items }: { label: string; items: NavItem[] }) {
	return (
		<SidebarGroup>
			<SidebarGroupLabel className="pointer-events-none select-none">{label}</SidebarGroupLabel>
			<SidebarMenu>
				{items.map((item) => (
					<SidebarMenuItem key={item.title}>
						<SidebarMenuButton
							size="lg"
							render={
								<Link className="space-x-2" href={item.url}>
									<div className="flex aspect-square size-8 items-center justify-center">
										{item.icon && <item.icon />}
									</div>
									<div className="pointer-events-none select-none">{item.title}</div>
								</Link>
							}
						/>
					</SidebarMenuItem>
				))}
			</SidebarMenu>
		</SidebarGroup>
	);
}
