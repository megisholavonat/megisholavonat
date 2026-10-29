import { stationRoute } from "@/components/seo/routes";

const route = stationRoute("hu");

export const generateMetadata = route.generateMetadata;
export default route.Page;
