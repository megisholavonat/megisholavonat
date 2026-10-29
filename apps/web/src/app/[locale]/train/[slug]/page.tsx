import { trainRoute } from "@/components/seo/routes";

const route = trainRoute("en");

export const generateMetadata = route.generateMetadata;
export default route.Page;
