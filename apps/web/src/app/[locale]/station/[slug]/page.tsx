import { stationRoute } from "@/components/seo/routes";

const route = stationRoute("en");

export const generateMetadata = route.generateMetadata;
export default route.Page;
