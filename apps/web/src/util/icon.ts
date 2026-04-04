import L from "leaflet";
import { ORANGE_THRESHOLD, RED_THRESHOLD, YELLOW_THRESHOLD } from "./constants";

export type VehicleType = "train" | "hev" | "tramtrain";

export function createTrainIcon(
    heading: number,
    color: string = "#00FF00",
    selected: boolean = false,
    falsified: boolean = false,
    vehicle_type: VehicleType = "hev",
    isDarkTheme: boolean = false,
) {
    const size = 30;

    const falsifiedCircle = falsified
        ? `<circle cx="36.5" cy="65.5" r="12" fill="red" stroke="black" stroke-width="3"/>`
        : "";

    let circleElement = "";
    let arrowElement = "";

    const borderClass = `train-marker-border-${vehicle_type}`;

    if (vehicle_type === "tramtrain") {
        // For tramtrain
        circleElement = `
      <circle cx="36.5" cy="65.5" r="28" fill="${
          selected ? "#5FC2FF" : color
      }" stroke="currentColor" stroke-width="10" class="${borderClass}"/>
    `;
        arrowElement = `
      <path d="M66.4144 63.6873C67.3842 65.68 65.9331 68.0001 63.7169 68.0001H9.28245C7.06633 68.0001 5.61517 65.68 6.58494 63.6873L33.8022 10.54289C34.897 8.293294 38.1024 8.293286 39.1972 10.54289L66.4144 63.6873Z" fill="currentColor" class="${borderClass}"/>
    `;
    } else if (vehicle_type === "hev") {
        // For hev
        circleElement = `
      <circle cx="36.5" cy="65.5" r="26.5" fill="${
          selected ? "#5FC2FF" : color
      }" stroke="currentColor" stroke-width="9" class="${borderClass}"/>
    `;
        arrowElement = `
      <path d="M62.4144 60.6873C63.3842 62.68 61.9331 65.0001 59.7169 65.0001H13.28245C11.06633 65.0001 9.61517 62.68 10.58494 60.6873L33.8022 10.54289C34.897 8.293294 38.1024 8.293286 39.1972 10.54289L62.4144 60.6873Z" fill="currentColor" class="${borderClass}"/>
    `;
    } else {
        // Default train styling
        circleElement = `
      <circle cx="36.5" cy="65.5" r="32.5" fill="${
          selected ? "#5FC2FF" : color
      }" stroke="currentColor" stroke-width="8" class="${borderClass}"/>
    `;
        arrowElement = `
      <path d="M70.4144 66.6873C71.3842 68.68 69.9331 71.0001 67.7169 71.0001H5.28245C3.06633 71.0001 1.61517 68.68 2.58494 66.6873L33.8022 2.54289C34.897 0.293294 38.1024 0.293286 39.1972 2.54289L70.4144 66.6873Z" fill="currentColor" class="${borderClass}"/>
    `;
    }

    const iconSvg = `
    <svg width="73" height="105" viewBox="0 0 73 105" fill="none" xmlns="http://www.w3.org/2000/svg">
    <g transform="rotate(${heading} 36.5 52.5)">
      ${arrowElement}
      ${circleElement}
      ${falsifiedCircle}
    </g>
    </svg>
  `;

    return new L.DivIcon({
        html: iconSvg,
        className: "train-marker",
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
        popupAnchor: [0, -size / 2],
    });
}

export function createStopIcon(
    stopName: string,
    hasPassed: boolean = false,
    showStationName: boolean = true,
    opacity: number = 0.9,
    isDarkTheme: boolean = false,
) {
    const stopColors = (() => {
        if (isDarkTheme) {
            if (hasPassed) {
                return {
                    circle: "#4B5563",
                    border: "#9CA3AF",
                    text: "#96989e",
                    boxBg: `rgba(55, 65, 81, ${opacity})`,
                    boxBorder: "rgba(148, 163, 184, 0.6)",
                };
            }
            return {
                circle: "#F3F4F6",
                border: "#E5E7EB",
                text: "#FFFFFF",
                boxBg: `rgba(31, 41, 55, ${opacity})`,
                boxBorder: "rgba(148, 163, 184, 0.6)",
            };
        }

        if (hasPassed) {
            return {
                circle: "#9ca3af",
                border: "#6b7280",
                text: "#6b7280",
                boxBg: `rgba(156, 163, 175, ${opacity})`,
                boxBorder: "#d1d5db",
            };
        }

        return {
            circle: "white",
            border: "#111827",
            text: "#111827",
            boxBg: `rgba(255, 255, 255, ${opacity})`,
            boxBorder: "#d1d5db",
        };
    })();

    const html = `
    <div style="display: flex; align-items: center; gap: 8px;">
      <div style="
        width: 16px; 
        height: 16px; 
        background-color: ${stopColors.circle}; 
        border: 2px solid ${stopColors.border}; 
        border-radius: 50%;
        flex-shrink: 0;
      "></div>
      ${
          showStationName
              ? `
      <div style="
        background-color: ${stopColors.boxBg}; 
        backdrop-filter: blur(4px);
        border: 1px solid ${stopColors.boxBorder}; 
        border-radius: 8px; 
        padding: 4px 8px; 
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        white-space: nowrap;
      ">
        <span style="
          font-size: 12px; 
          font-weight: 600; 
          color: ${stopColors.text};
        ">${stopName}</span>
      </div>`
              : ""
      }
    </div>
  `;

    return new L.DivIcon({
        html: html,
        className: "stop-marker",
        iconSize: [0, 0],
        iconAnchor: [8, 8],
    });
}

export function getDelayColor(
    delay: number,
    active: boolean = true,
    isStale: boolean = false,
): string {
    if (isStale) {
        return "#9CA3AF"; // Gray for stale data
    }

    if (!active) {
        return "#4AD94A";
    }

    if (delay >= RED_THRESHOLD) {
        return "#D9564A"; // Red - 1 hour and above
    } else if (delay >= ORANGE_THRESHOLD) {
        return "#DF9227"; // Orange - 15-60 minutes
    } else if (delay >= YELLOW_THRESHOLD) {
        return "#E4DE3A"; // Yellow - 5-15 minutes
    }

    return "#4AD94A"; // Green - on time or up to 5 minutes late
}

export function createUserLocationIcon() {
    const iconSvg = `
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <!-- Outer pulse ring -->
      <circle cx="16" cy="16" r="14" fill="rgba(59, 130, 246, 0.15)" stroke="rgba(59, 130, 246, 0.4)" stroke-width="1">
        <animate attributeName="r" values="8;14;8" dur="2s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="0.8;0.2;0.8" dur="2s" repeatCount="indefinite"/>
      </circle>
      <!-- Middle ring -->
      <circle cx="16" cy="16" r="10" fill="rgba(59, 130, 246, 0.25)" stroke="rgba(59, 130, 246, 0.6)" stroke-width="1"/>
      <!-- Inner dot -->
      <circle cx="16" cy="16" r="6" fill="#2563EB" stroke="white" stroke-width="2"/>
      <!-- Center highlight -->
      <circle cx="16" cy="16" r="3" fill="#60A5FA"/>
    </svg>
  `;

    return new L.Icon({
        iconUrl: `data:image/svg+xml;base64,${btoa(iconSvg)}`,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
        popupAnchor: [0, -16],
    });
}
