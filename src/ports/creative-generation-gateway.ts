import type {
  CreativeBrief,
  CreativeDirection,
  CreativeOutput
} from "../domain/creative-run";
import type { Brand } from "../domain/brand";

export interface CreativeGenerationGateway {
  generateDirections(input: {
    brand: Brand | null;
    brief: CreativeBrief;
  }): Promise<readonly CreativeDirection[]>;

  generateOutputs(input: {
    brand: Brand | null;
    brief: CreativeBrief;
    directions: readonly CreativeDirection[];
  }): Promise<readonly CreativeOutput[]>;
}
