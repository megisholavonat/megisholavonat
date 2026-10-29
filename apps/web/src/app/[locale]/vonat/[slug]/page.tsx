import { trainRoute } from "@/components/seo/routes";

const route = trainRoute("hu");

export const generateMetadata = route.generateMetadata;
export default route.Page;
