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
    id: 'sofa',
    name: 'Glam Sofa',
    category: 'Furniture',
    icon: '🛋️',
    url: 'models/sofa.glb',
    credit: '"GlamVelvetSofa" by Wayfair, via Khronos glTF Sample Assets (CC BY 4.0)',
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