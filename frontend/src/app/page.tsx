import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { SessionStartPage } from "@/components/start/session-start-page";
import { readBrianFiles } from "@/lib/brian/reader";

export default function Home() {
	const files = readBrianFiles();

	return (
		<>
			<SessionStartPage />
		</>
	);
}
