export interface SampleModel {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly icon: string;
  readonly url: string;
  readonly credit: string;
}

export const SAMPLE_MODELS: readonly SampleModel[] = [
  {
    id: 'chair',
    name: 'Velvet Chair',
    category: 'Furniture',
    icon: '🪑',
    url: 'models/chair.glb',
    credit: '"SheenChair" by Wayfair, via Khronos glTF Sample Assets (CC BY 4.0)',
  },
  {
    // Replaces the sofa. Put the truck file next to the other models as models/truck.glb
    id: 'truck',
    name: 'Milk Truck',
    category: 'Vehicles',
    icon: '🚚',
    url: 'models/truck.glb',
    credit: '"CesiumMilkTruck" by Cesium, via Khronos glTF Sample Assets (CC BY 4.0)',
  },
  {
    id: 'sunglasses',
    name: 'Sunglasses',
    category: 'Accessories',
    icon: '🕶️',
    url: 'models/sunglasses.glb',
    credit: '"SunglassesKhronos" by Darmstadt Graphics Group, via Khronos glTF Sample Assets (CC BY 4.0)',
  },
];