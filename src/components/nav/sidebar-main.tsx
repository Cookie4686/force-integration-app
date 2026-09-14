"use client";

import { ChevronRight, type LucideIcon } from "lucide-react";

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
													render={
														<a href={subItem.url}>
															<span>{subItem.title}</span>
														</a>
													}
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
			<SidebarGroupLabel>{label}</SidebarGroupLabel>
			<SidebarMenu>
				{items.map((item) => (
					<SidebarMenuItem key={item.title}>
						<SidebarMenuButton
							render={
								<a className="flex gap-2" href={item.url}>
									{item.icon && <item.icon size="lg" />}
									<span>{item.title}</span>
								</a>
							}
						/>
					</SidebarMenuItem>
				))}
			</SidebarMenu>
		</SidebarGroup>
	);
}
