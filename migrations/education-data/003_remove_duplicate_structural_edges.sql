-- Early demo seeds synthesized part_of edges even when the source ontology
-- already contained the same semantic edge. Only delete synthesized rows when
-- a distinct source-backed row with the same endpoints and type exists.
DELETE FROM education_ontology_relations AS generated
WHERE generated.relation_type = 'part_of'
  AND json_extract(generated.properties_json, '$.generated_structure_edge') = 1
  AND EXISTS (
    SELECT 1
    FROM education_ontology_relations AS source_backed
    WHERE source_backed.tenant_id = generated.tenant_id
      AND source_backed.ontology_id = generated.ontology_id
      AND source_backed.ontology_version = generated.ontology_version
      AND source_backed.source_entity_id = generated.source_entity_id
      AND source_backed.target_entity_id = generated.target_entity_id
      AND source_backed.relation_type = generated.relation_type
      AND source_backed.relation_id <> generated.relation_id
      AND COALESCE(json_extract(source_backed.properties_json, '$.generated_structure_edge'), 0) <> 1
  );
