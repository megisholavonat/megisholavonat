import { useEffect } from 'react';
import { useMap } from 'react-map-gl/maplibre';

type MapImageProps = {
  id: string;
  svg: string;
  sdf?: boolean;
};

export function MapImage({ id, svg, sdf = false }: MapImageProps) {
  const { current: map } = useMap();

  useEffect(() => {
    if (!map) return;
    if (map.hasImage(id)) return;

    const img = new Image(48, 48);
    img.onload = () => {
      if (!map.hasImage(id)) {
        map.addImage(id, img, { sdf });
      }
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);

    return () => {
      if (map.hasImage(id)) map.removeImage(id);
    };
  }, [map, id, svg, sdf]);

  return null;
}
